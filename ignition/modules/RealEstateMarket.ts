import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

/**
 * Деплой:
 *  1. PropertyOracle  — fulfiller = Hardhat account #5 (0x67Cc...)
 *  2. RealEstateMarket
 *
 * ВАЖНО: fulfiller должен совпадать с адресом из FULFILLER_PRIVATE_KEY в oracle-backend/.env
 * Адрес 0x67Cc... соответствует ключу из .env (проверить: node -e "new ethers.Wallet(KEY).address")
 */

const RealEstateMarketModule = buildModule("RealEstateMarketModule", (m) => {
  // Этот адрес должен совпадать с адресом который выводит oracle-backend при старте
  // "Fulfiller: 0x67Cc5956C1886260CB2e77c160bB9daF75d24123"
  const fulfiller = m.getParameter(
    "fulfiller",
    "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
  );

  const oracle = m.contract("PropertyOracle", [fulfiller]);
  const market = m.contract("RealEstateMarket", [oracle]);

  return { oracle, market };
});

export default RealEstateMarketModule;
