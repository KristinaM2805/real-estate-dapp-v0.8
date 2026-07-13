/**
 * oracle-backend/server.mjs
 *
 * Mock-сервер оракула реестра недвижимости.
 * В реальном проекте это был бы Chainlink Any API node или
 * собственный сервис с доступом к государственному API Росреестра.
 *
 * Запуск: node oracle-backend/server.mjs
 *
 * Требует: npm install ethers dotenv express
 * Переменные окружения в oracle-backend/.env:
 *   RPC_URL=http://127.0.0.1:8545
 *   ORACLE_ADDRESS=0x...
 *   MARKET_ADDRESS=0x...
 *   FULFILLER_PRIVATE_KEY=0x...  (счёт #2 Hardhat: 0x5de4...)
 */

import { ethers } from "ethers";
import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, ".env") });

const {
  RPC_URL = "http://127.0.0.1:8545",
  ORACLE_ADDRESS,
  MARKET_ADDRESS,
  FULFILLER_PRIVATE_KEY,
  PORT = "3001",
} = process.env;

if (!ORACLE_ADDRESS || !MARKET_ADDRESS || !FULFILLER_PRIVATE_KEY) {
  console.error("❌ Missing env: ORACLE_ADDRESS, MARKET_ADDRESS, FULFILLER_PRIVATE_KEY");
  process.exit(1);
}

// ─── ABIs ─────────────────────────────────────────────────────────────────────

const ORACLE_ABI = [
  "event VerificationRequest(uint256 indexed requestId, uint256 indexed dealId, address indexed dealContract, uint8 reqType, string cadastralNumber, string subjectAddress, string fullName)",
  "event RegistryTransferRequest(uint256 indexed requestId, uint256 indexed dealId, address indexed dealContract, string cadastralNumber, string sellerFullName, string buyerFullName, uint256 priceWei)",
  "function fulfilSellerVerification(uint256 requestId, bool success, string reason)",
  "function fulfilBuyerVerification(uint256 requestId, bool success, string reason)",
  "function fulfilRegistryTransfer(uint256 requestId, bool success, string newRegistryId)",
];

const MARKET_ABI = [
  "event DealCreated(uint256 indexed dealId, address indexed seller, uint256 price, string cadastralNumber)",
  "event StageChanged(uint256 indexed dealId, uint8 stage, string visualText)",
];

// ─── Mock Registry Database ───────────────────────────────────────────────────
// В реальном проекте — запрос к API Росреестра / Едином реестру

const MOCK_REGISTRY = {
  // cadastralNumber → { ownerAddress (lowercase), ownerName }
  "77:01:0004012:1056": {
    ownerAddress: "0x8Ba321cCB99c2d01C71A002B5D605646Ec18fE4C",
    ownerName: "Ivan Petrov",
    registryId: "REG-2026-000001",
  },
  "77:02:0001234:5678": {
    ownerAddress: "0x70997970c51812dc3a010c7d01b50e0d17dc79c8", 
    ownerName: "Anna Sidorova",
    registryId: "REG-2026-000002",
  },
};

// Флаги для имитации поведения (можно менять через HTTP API)
let config = {
  sellerVerificationDelay: 2000,  // ms
  buyerVerificationDelay: 2000,
  registryDelay: 3000,
  sellerVerificationShouldFail: false,
  buyerVerificationShouldFail: false,
  registryShouldFail: false,
};

// ─── Setup ethers ─────────────────────────────────────────────────────────────

const provider = new ethers.JsonRpcProvider(RPC_URL);
const fulfiller = new ethers.Wallet(FULFILLER_PRIVATE_KEY, provider);
const oracleContract = new ethers.Contract(ORACLE_ADDRESS, ORACLE_ABI, fulfiller);

console.log(`🔮 Oracle backend starting...`);
console.log(`   Oracle contract:  ${ORACLE_ADDRESS}`);
console.log(`   Market contract:  ${MARKET_ADDRESS}`);
console.log(`   Fulfiller:        ${fulfiller.address}`);
console.log(`   RPC:              ${RPC_URL}`);

let nextRegistrySeq = 100;
const processed = new Set();

// ─── Event listeners ──────────────────────────────────────────────────────────

let lastProcessedBlock = await provider.getBlockNumber();

async function processOracleLogs() {
  try {
    const latestBlock = await provider.getBlockNumber();

    if (latestBlock <= lastProcessedBlock) {
      return;
    }

    const logs = await provider.getLogs({
      address: ORACLE_ADDRESS,
      fromBlock: lastProcessedBlock + 1,
      toBlock: latestBlock,
    });

    lastProcessedBlock = latestBlock;

    for (const log of logs) {
      let parsed;

      try {
        parsed = oracleContract.interface.parseLog(log);
      } catch {
        continue;
      }

      if (!parsed) continue;

      if (parsed.name === "VerificationRequest") {
        const [
          requestId,
          dealId,
          dealContract,
          reqType,
          cadastralNumber,
          subjectAddress,
          fullName,
        ] = parsed.args;

        const rid = requestId.toString();
        if (processed.has(rid)) continue;
        processed.add(rid);

        const reqTypeNum = Number(reqType);

        console.log(`\n📨 VerificationRequest #${rid} (deal ${dealId}, type=${reqTypeNum})`);
        console.log(`   Subject: ${subjectAddress} | ${fullName}`);
        if (cadastralNumber) {
          console.log(`   Cadastral: ${cadastralNumber}`);
        }

        if (reqTypeNum === 0) {
          await handleSellerVerification(
            rid,
            dealId,
            cadastralNumber,
            subjectAddress,
            fullName
          );
        } else if (reqTypeNum === 1) {
          await handleBuyerVerification(
            rid,
            dealId,
            subjectAddress,
            fullName
          );
        }
      }

      if (parsed.name === "RegistryTransferRequest") {
        const [
          requestId,
          dealId,
          dealContract,
          cadastralNumber,
          sellerFullName,
          buyerFullName,
          priceWei,
        ] = parsed.args;

        const rid = requestId.toString();
        if (processed.has(rid)) continue;
        processed.add(rid);

        console.log(`\n📨 RegistryTransferRequest #${rid} (deal ${dealId})`);
        console.log(`   Cadastral: ${cadastralNumber}`);
        console.log(`   ${sellerFullName} → ${buyerFullName}`);
        console.log(`   Price: ${ethers.formatEther(priceWei)} ETH`);

        await handleRegistryTransfer(
          rid,
          dealId,
          cadastralNumber,
          sellerFullName,
          buyerFullName,
          priceWei
        );
      }
    }
  } catch (err) {
    console.error("❌ Oracle polling error:", err.message);
  }
}
setInterval(() => {
  processOracleLogs().catch((err) => {
    console.error("❌ Oracle polling error:", err.message);
  });
}, 2000);


async function handleSellerVerification(requestId, dealId, cadastralNumber, sellerAddress, sellerFullName) {
  await sleep(config.sellerVerificationDelay);

  if (config.sellerVerificationShouldFail) {
    console.log(`   ✗ [MOCK FAIL] Seller verification failed`);
    await sendTx(() => oracleContract.fulfilSellerVerification(requestId, false, "MOCK: Registry verification forced to fail"));
    return;
  }

  // Проверяем реестр
  const record = MOCK_REGISTRY[cadastralNumber];
  if (!record) {
    console.log(`   ✗ Cadastral number not found in registry: ${cadastralNumber}`);
    await sendTx(() => oracleContract.fulfilSellerVerification(requestId, false, `Cadastral number ${cadastralNumber} not found in registry`));
    return;
  }

  // Нормализуем адрес
  const normalizedInput = sellerAddress.toLowerCase();
  const normalizedOwner = record.ownerAddress.toLowerCase();

  if (normalizedInput !== normalizedOwner) {
    console.log(`   ✗ Address mismatch. Registry owner: ${record.ownerAddress}`);
    await sendTx(() => oracleContract.fulfilSellerVerification(requestId, false, `Registry shows different owner: ${record.ownerName}`));
    return;
  }

  // Проверяем ФИО (нечёткое совпадение — упрощённо)
  const nameMatch = record.ownerName.toLowerCase().includes(sellerFullName.toLowerCase().split(" ")[0].toLowerCase());
  if (!nameMatch && sellerFullName.length > 0) {
    console.log(`   ⚠ Name mismatch (non-fatal in demo): ${sellerFullName} vs ${record.ownerName}`);
    // В demo не блокируем по ФИО, только логируем
  }

  console.log(`   ✓ Seller verified: ${sellerFullName} owns ${cadastralNumber}`);
  await sendTx(() => oracleContract.fulfilSellerVerification(requestId, true, "Owner verified in state registry"));
}

async function handleBuyerVerification(requestId, dealId, buyerAddress, buyerFullName) {
  await sleep(config.buyerVerificationDelay);

  if (config.buyerVerificationShouldFail) {
    console.log(`   ✗ [MOCK FAIL] Buyer verification failed`);
    await sendTx(() => oracleContract.fulfilBuyerVerification(requestId, false, "MOCK: Buyer verification forced to fail"));
    return;
  }

  // В реальной системе: проверка паспортных данных через МФЦ API
  // В demo: любой покупатель с непустым ФИО проходит
  if (!buyerFullName || buyerFullName.trim().length < 3) {
    console.log(`   ✗ Buyer name too short`);
    await sendTx(() => oracleContract.fulfilBuyerVerification(requestId, false, "Buyer full name is invalid"));
    return;
  }

  console.log(`   ✓ Buyer verified: ${buyerFullName}`);
  await sendTx(() => oracleContract.fulfilBuyerVerification(requestId, true, "Buyer identity confirmed"));
}

async function handleRegistryTransfer(requestId, dealId, cadastralNumber, sellerFullName, buyerFullName, priceWei) {
  await sleep(config.registryDelay);

  if (config.registryShouldFail) {
    console.log(`   ✗ [MOCK FAIL] Registry transfer failed`);
    await sendTx(() => oracleContract.fulfilRegistryTransfer(requestId, false, "MOCK: Registry transfer forced to fail"));
    return;
  }

  const record = MOCK_REGISTRY[cadastralNumber];
  if (!record) {
    console.log(`   ✗ Property not found in registry`);
    await sendTx(() => oracleContract.fulfilRegistryTransfer(requestId, false, `Property ${cadastralNumber} not found`));
    return;
  }

  // Симулируем запись в реестр
  const newRegistryId = `REG-${new Date().getFullYear()}-${String(nextRegistrySeq++).padStart(6, "0")}`;
  MOCK_REGISTRY[cadastralNumber] = {
    ...record,
    ownerName: buyerFullName,
    registryId: newRegistryId,
    // В реальности ownerAddress тоже обновился бы через blockchain integration
  };

  console.log(`   ✓ Registry updated: ${sellerFullName} → ${buyerFullName}`);
  console.log(`   New registry ID: ${newRegistryId}`);
  await sendTx(() => oracleContract.fulfilRegistryTransfer(requestId, true, newRegistryId));
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function sendTx(fn) {
  try {
    const tx = await fn();
    const receipt = await tx.wait();
    console.log(`   📤 TX confirmed: ${receipt.hash.slice(0, 14)}...`);
  } catch (err) {
    console.error(`   ❌ TX error: ${err.message}`);
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ─── HTTP control API ─────────────────────────────────────────────────────────

const app = express();
app.use(express.json());

app.get("/status", (req, res) => {
  res.json({ status: "ok", config, processedRequests: processed.size });
});

app.get("/registry", (req, res) => {
  res.json(MOCK_REGISTRY);
});

app.patch("/config", (req, res) => {
  config = { ...config, ...req.body };
  console.log(`\n⚙️  Config updated:`, config);
  res.json({ ok: true, config });
});

app.post("/registry/:cadastral", (req, res) => {
  const { cadastral } = req.params;
  MOCK_REGISTRY[decodeURIComponent(cadastral)] = req.body;
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`\n🚀 Oracle backend HTTP API: http://localhost:${PORT}`);
  console.log(`   GET  /status          — статус`);
  console.log(`   GET  /registry        — текущий реестр`);
  console.log(`   PATCH /config         — изменить поведение (shouldFail, delay...)`);
  console.log(`   POST /registry/:num   — добавить запись в реестр`);
  console.log(`\n👂 Listening for oracle events...`);
  processOracleLogs().catch((err) => {
  console.error("❌ Initial oracle polling error:", err.message);
});
});
