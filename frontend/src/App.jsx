import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { ethers } from "ethers";
import "./App.css";

import {
  MARKET_ADDRESS,
  MARKET_ABI,
} from "./contractConfig";

import AnimatedScene from "./AnimatedScene";

const anime = () => window.anime;

const STAGES = [
  "Сделка создана",
  "Данные продавца поданы",
  "Продавец верифицирован",
  "Данные покупателя поданы",
  "Покупатель верифицирован",
  "Оплата получена",
  "Запрос в реестр",
  "Сделка завершена",
  "Сделка отменена",
];

function shortAddr(a) {
  if (!a) return "";
  return `${a.slice(0, 6)}...${a.slice(-4)}`;
}
function normalize(a) { return a?.toLowerCase(); }
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
function isZeroAddress(a) {
  return !a || normalize(a) === normalize(ZERO_ADDRESS);
}
function fmtTime(v) {
  if (!v) return "—";
  const n = Number(v);
  return n ? new Date(n * 1000).toLocaleString("ru-RU") : "—";
}
function fmtSec(s) {
  if (s <= 0) return "срок истёк";
  const m = Math.floor(s / 60), r = s % 60;
  return m <= 0 ? `${r} сек.` : `${m} мин. ${r} сек.`;
}
const delay = (ms) => new Promise(r => setTimeout(r, ms));

// ─── MetaMask Toast ──────────────────────────────────────────────────────────
function MetaMaskToast({ status, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    if (status === "idle" || !ref.current) return;
    const a = anime();
    if (a) a({ targets: ref.current, translateX: [120, 0], opacity: [0, 1], duration: 380, easing: "easeOutBack" });
  }, [status]);

  if (status === "idle") return null;
  return (
    <div ref={ref} className={`mm-toast mm-toast--${status}`} role="status">
      <div className="mm-toast__header">
        <span className="mm-fox">🦊</span>
        <span className="mm-toast__title">MetaMask</span>
        {status !== "waiting" && <button className="mm-toast__close" onClick={onClose}>×</button>}
      </div>
      <div className="mm-toast__body">
        {status === "waiting" && (<><div className="mm-spinner"><div/><div/><div/></div><div><p className="mm-toast__label">Ожидание подписи</p><p className="mm-toast__sub">Подтвердите в MetaMask</p></div></>)}
        {status === "success" && (<><span className="mm-toast__icon mm-toast__icon--ok">✓</span><div><p className="mm-toast__label">Подтверждено!</p></div></>)}
        {status === "error" && (<><span className="mm-toast__icon mm-toast__icon--err">✕</span><div><p className="mm-toast__label">Отклонено</p></div></>)}
      </div>
      {status === "waiting" && <div className="mm-toast__progress"><div className="mm-toast__progress-bar"/></div>}
    </div>
  );
}

// ─── Stage Progress ───────────────────────────────────────────────────────────
function StageProgress({ stage, isCancelled }) {
  const steps = [
    { icon: "🏠", label: "Создана" },
    { icon: "✍️", label: "Продавец" },
    { icon: "🔍", label: "Проверка" },
    { icon: "🧍", label: "Покупатель" },
    { icon: "💰", label: "Оплата" },
    { icon: "📋", label: "Реестр" },
    { icon: "✅", label: "Готово" },
  ];
  const vs = stage >= 7 ? 6 : stage >= 6 ? 5 : stage >= 5 ? 4 : stage >= 4 ? 3 : stage >= 2 ? 2 : stage >= 1 ? 1 : 0;
  return (
    <div className="stage-progress">
      {steps.map((s, i) => {
        const done = !isCancelled && vs > i;
        const active = !isCancelled && vs === i;
        return (
          <div key={i} className={`stage-step ${done?"done":""} ${active?"active":""} ${isCancelled&&i>=vs?"cancelled":""}`}>
            <div className="stage-step__dot"><span>{done ? "✓" : (isCancelled && i >= vs) ? "✕" : s.icon}</span></div>
            <span className="stage-step__label">{s.label}</span>
            {i < steps.length - 1 && <div className={`stage-step__line ${done?"done":""}`}/>}
          </div>
        );
      })}
    </div>
  );
}

// ─── Create Deal Form ─────────────────────────────────────────────────────────
function CreateDealForm({ onSubmit, disabled }) {
  const [form, setForm] = useState({
    cadastralNumber: "77:01:0004012:1056",
    apartmentAddress: "г. Екатеринбург, ул. Щербакова, д. 4, кв. 12",
    propertyDocumentHash: "QmHash123abc",
    registryRecordId: "REG-2026-000001",
    priceEth: "0.01",
    timeoutMinutes: "30",
  });
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  return (
    <div className="create-deal-form">
      <h3>Параметры сделки</h3>
      <div className="form-grid">
        <div className="form-field"><label>Кадастровый номер</label><input value={form.cadastralNumber} onChange={set("cadastralNumber")}/></div>
        <div className="form-field"><label>Адрес объекта</label><input value={form.apartmentAddress} onChange={set("apartmentAddress")}/></div>
        <div className="form-field"><label>Хеш документа</label><input value={form.propertyDocumentHash} onChange={set("propertyDocumentHash")}/></div>
        <div className="form-field"><label>ID в реестре</label><input value={form.registryRecordId} onChange={set("registryRecordId")}/></div>
        <div className="form-field"><label>Цена (ETH)</label><input type="number" step="0.001" value={form.priceEth} onChange={set("priceEth")}/></div>
        <div className="form-field"><label>Срок оплаты (минут)</label><input type="number" value={form.timeoutMinutes} onChange={set("timeoutMinutes")}/></div>
      </div>
      <button className="action-btn action-btn--blue" disabled={disabled}
        style={{ marginTop: 14, width: "100%" }}
        onClick={() => onSubmit({
          cadastralNumber: form.cadastralNumber,
          apartmentAddress: form.apartmentAddress,
          propertyDocumentHash: form.propertyDocumentHash,
          registryRecordId: form.registryRecordId,
          priceWei: ethers.parseEther(form.priceEth || "0.01"),
          timeoutSeconds: Number(form.timeoutMinutes) * 60,
        })}>
        <span className="action-btn__num">✦</span>
        <span className="action-btn__text"><strong>Создать сделку</strong><small>Записать в смарт-контракт</small></span>
      </button>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [account, setAccount] = useState("");
  const [contract, setContract] = useState(null);
  const [deal, setDeal] = useState(null);
  const [dealId, setDealId] = useState(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("Подключи MetaMask к локальной сети Hardhat");
  const [mmStatus, setMmStatus] = useState("idle");
  const [animPhase, setAnimPhase] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);
  const [sellerName, setSellerName] = useState("Ivan Petrov");
  const [sellerPassport, setSellerPassport] = useState("hash_seller_001");
  const [buyerName, setBuyerName] = useState("Kristina Maykushina");
  const [buyerPassport, setBuyerPassport] = useState("hash_buyer_001");
  const [currentTs, setCurrentTs] = useState(Math.floor(Date.now() / 1000));
  const [isCertOpen, setIsCertOpen] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const mmTimer = useRef(null);
  const pollRef = useRef(null);

  const stage = deal?.stage ?? 0;
  const hasBuyer = deal?.buyer && !isZeroAddress(deal.buyer);
  const isSeller = Boolean(account && deal?.seller && normalize(account) === normalize(deal.seller));
  const isBuyer = Boolean(account && hasBuyer && normalize(account) === normalize(deal.buyer));
  const canJoinAsBuyer = Boolean(account && deal && !isSeller && !hasBuyer && stage === 2);
  const isDealCreator = isSeller;
  const isCompleted = stage === 7;
  const isCancelled = stage === 8;

  const paymentDeadlineN = deal?.paymentDeadline ? Number(deal.paymentDeadline) : 0;
  const paymentPassed = paymentDeadlineN > 0 && currentTs > paymentDeadlineN;
  const secToDeadline = paymentDeadlineN > 0 ? Math.max(0, paymentDeadlineN - currentTs) : 0;

  const priceEth = deal?.price ? ethers.formatEther(deal.price) : "—";

  const role = useMemo(() => {
    if (!account) return "Не подключён";
    if (isSeller) return "Продавец";
    if (isBuyer) return "Покупатель";
    if (canJoinAsBuyer) return "Покупатель / может присоединиться";
    return "Подключённый пользователь";
  }, [account, isSeller, isBuyer, canJoinAsBuyer]);

  // Для canvas-сцены передаём реальный stage контракта, иначе действия отображаются с задержкой.
 const visualStage = isCancelled ? 0 : stage;
  const certLocation = isCompleted ? "buyer" : isCancelled ? "seller" : stage >= 2 ? "escrow" : "seller";
  const moneyLocation = isCompleted ? "seller" : isCancelled ? "buyer" : stage >= 5 ? "escrow" : "buyer";

  async function loadDeal(c = contract, id = dealId) {
    if (!c || id === null || id === undefined) return;
    try {
      const [main, prop, parties] = await Promise.all([
        c.getDealMain(id),
        c.getDealProperty(id),
        c.getDealParties(id),
      ]);
      setDeal({
        id: Number(main[0]),
        seller: main[1], buyer: main[2],
        stage: Number(main[3]),
        price: main[4], contractBalance: main[5],
        paymentDeadline: main[6], createdAt: main[7], completedAt: main[8],
        cadastralNumber: prop[0], apartmentAddress: prop[1],
        registryRecordId: prop[2], newRegistryRecordId: prop[3], lastOracleError: prop[4],
        sellerFullName: parties[0], buyerFullName: parties[1],
      });
    } catch (e) { console.error("loadDeal:", e); }
  }


  async function loadLastDealForAddress(c, address) {
    if (!c || !address) return false;

    try {
      const count = Number(await c.getDealCount());
      let lastMatch = null;

      for (let i = 0; i < count; i++) {
        try {
          const main = await c.getDealMain(i);
          const seller = main[1];
          const buyer = main[2];

          const isAddressSeller = normalize(seller) === normalize(address);
          const isAddressBuyer = !isZeroAddress(buyer) && normalize(buyer) === normalize(address);

          if (isAddressSeller || isAddressBuyer) {
            lastMatch = i;
          }
        } catch (e) {
          console.warn(`Не удалось прочитать сделку #${i}:`, e);
        }
      }

      if (lastMatch !== null) {
        setDealId(lastMatch);
        await loadDeal(c, lastMatch);
        setShowCreateForm(false);
        setMessage(`Загружена сделка #${lastMatch}.`);
        return true;
      }

      return false;
    } catch (e) {
      console.warn("Не удалось найти сделки аккаунта:", e);
      return false;
    }
  }

  // Poll while oracle is working
  useEffect(() => {
    clearInterval(pollRef.current);
    if (contract && dealId !== null && (stage === 1 || stage === 3 || stage === 6)) {
      pollRef.current = setInterval(() => loadDeal(contract, dealId), 3000);
    }
    return () => clearInterval(pollRef.current);
  }, [contract, dealId, stage]);

  async function getFresh() {
    if (!window.ethereum) throw new Error("MetaMask не найден");
    const provider = new ethers.BrowserProvider(window.ethereum);
    const accounts = await provider.send("eth_requestAccounts", []);
    const signer = await provider.getSigner();
    const c = new ethers.Contract(MARKET_ADDRESS, MARKET_ABI, signer);
    setAccount(accounts[0]);
    setContract(c);
    return { c, address: accounts[0] };
  }

  async function connectWallet() {
    try {
      const { c, address } = await getFresh();
      setMessage("Кошелёк подключён!");

      const found = await loadLastDealForAddress(c, address);
      if (!found) {
        setDeal(null);
        setDealId(null);
        setShowCreateForm(true);
        setMessage("Кошелёк подключён. Сделок для этого аккаунта пока нет — можно создать новую или открыть сделку по ID.");
      }
    } catch (e) {
      setMessage(e?.reason || e?.shortMessage || e?.message || "Ошибка");
    }
  }

  const closeMm = useCallback(() => { clearTimeout(mmTimer.current); setMmStatus("idle"); }, []);

  async function runTx(fn, animMsg, successMsg) {
    try {
      const { c } = await getFresh();
      setPending(true);
      setMmStatus("waiting");
      setMessage("Подтвердите транзакцию в MetaMask...");
      const tx = await fn(c);
      await tx.wait();
      setMmStatus("success");
      mmTimer.current = setTimeout(() => setMmStatus("idle"), 3000);
      setMessage(animMsg);
      setIsAnimating(true);
      setAnimPhase(p => p + 1);
      await delay(4000);
      setIsAnimating(false);
      await loadDeal(c, dealId);
      setMessage(successMsg);
    } catch (e) {
      console.error(e);
      setMmStatus("error");
      mmTimer.current = setTimeout(() => setMmStatus("idle"), 4000);
      setMessage(e?.reason || e?.shortMessage || e?.message || "Ошибка транзакции");
    } finally { setPending(false); }
  }

  async function handleCreateDeal(params) {
    try {
      const { c } = await getFresh();
      setPending(true); setMmStatus("waiting");
      setMessage("Создаём сделку в блокчейне...");
      const tx = await c.createDeal(
        params.cadastralNumber, params.apartmentAddress,
        params.propertyDocumentHash, params.registryRecordId,
        params.priceWei, params.timeoutSeconds
      );
      const receipt = await tx.wait();
      const iface = new ethers.Interface(MARKET_ABI);
      let newId = null;
      for (const log of receipt.logs) {
        try { const p = iface.parseLog(log); if (p?.name === "DealCreated") { newId = Number(p.args.dealId); break; } } catch {}
      }
      setMmStatus("success");
      mmTimer.current = setTimeout(() => setMmStatus("idle"), 3000);
      if (newId !== null) {
        setDealId(newId); await loadDeal(c, newId);
        setMessage(`✅ Сделка #${newId} создана! Теперь введите данные продавца.`);
      }
      setShowCreateForm(false);
    } catch (e) {
      setMmStatus("error");
      mmTimer.current = setTimeout(() => setMmStatus("idle"), 4000);
      setMessage(e?.reason || e?.shortMessage || e?.message || "Ошибка");
    } finally { setPending(false); }
  }

  useEffect(() => {
    const t = setInterval(() => setCurrentTs(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!window.ethereum) return;
    const onAcc = (accs) => { const a = accs?.[0] || ""; setAccount(a); if (!a) { setContract(null); setDeal(null); setDealId(null); setMessage("Кошелёк отключён."); }};
    const onChain = () => window.location.reload();
    window.ethereum.on("accountsChanged", onAcc);
    window.ethereum.on("chainChanged", onChain);
    return () => { window.ethereum.removeListener("accountsChanged", onAcc); window.ethereum.removeListener("chainChanged", onChain); };
  }, []);

  useEffect(() => {
    const a = anime();
    if (!a) return;
    a({ targets: ".action-btn", translateY: [30, 0], opacity: [0, 1], delay: a.stagger(60, { start: 200 }), duration: 500, easing: "easeOutBack" });
  }, []);

  const oracleLabel = stage === 1 ? "⏳ Оракул проверяет право собственности продавца..."
    : stage === 3 ? "⏳ Оракул проверяет личность покупателя..."
    : stage === 6 ? "⏳ Реестр переоформляет право собственности..."
    : null;

  useEffect(() => {
  if (isCompleted) {
    setMessage("✅ Сделка завершена: право собственности переписано, средства переведены продавцу, покупатель получил ключи.");
  }

  if (isCancelled) {
    if (deal?.lastOracleError) {
      setMessage(`❌ Сделка отменена: ${deal.lastOracleError}`);
    } else {
      setMessage("❌ Сделка отменена.");
    }
  }
}, [isCompleted, isCancelled, deal?.lastOracleError]);

  return (
    <main className="page">
      <MetaMaskToast status={mmStatus} onClose={closeMm} />

      <section className="hero">
        <div>
          <p className="eyebrow">Real Estate Smart Contract dApp</p>
          <h1>Передача права собственности<br/>через смарт-контракт</h1>
          <p className="subtitle">
            Оракул верифицирует стороны, смарт-контракт хранит деньги в escrow,
            реестр автоматически переоформляет право собственности.
          </p>
        </div>
        <button className="connectButton" onClick={connectWallet}>
          {account ? <><span className="connect-dot"/>{shortAddr(account)}</> : "Подключить MetaMask"}
        </button>
      </section>

      <section className="statusPanel">
        <div><span>Роль</span><strong>{role}</strong></div>
        <div><span>Этап сделки</span><strong>{deal ? STAGES[stage] : "—"}</strong></div>
        <div><span>Баланс escrow</span>
          <strong>{deal?.contractBalance !== undefined ? `${ethers.formatEther(deal.contractBalance)} ETH` : "—"}</strong>
        </div>
      </section>

      {oracleLabel && (
        <div className="oracle-waiting">
          <div className="oracle-waiting__dot"/>
          <div>
            <span>{oracleLabel}</span>
            <span className="oracle-waiting__sub">oracle-backend обрабатывает запрос (~2–3 сек)</span>
          </div>
        </div>
      )}

      {deal && <StageProgress stage={stage} isCancelled={isCancelled}/>}

      <section className="deal-workbench">
        <div className="deal-workbench__scene">
      <AnimatedScene
        visualStage={visualStage}
        isCompleted={isCompleted}
        isCancelled={isCancelled}
        deal={deal}
        buyerNameInput={buyerName}
        certificateLocation={certLocation}
        moneyLocation={moneyLocation}
        onCertificateClick={() => setIsCertOpen(true)}
        onMoneyClick={() => {}}
        animationTrigger={animPhase}
      />
        </div>

      <aside className="controls controls--side">

        {/* Create deal — any connected account can become seller */}
        {account && !deal && (
          <>
            <button className="action-btn action-btn--blue" style={{ gridColumn: "1/-1" }}
              disabled={pending} onClick={() => setShowCreateForm(v => !v)}>
              <span className="action-btn__num">✦</span>
              <span className="action-btn__text">
                <strong>{showCreateForm ? "Скрыть форму" : "Создать сделку"}</strong>
                <small>Задать параметры объекта и цену</small>
              </span>
            </button>
            {showCreateForm && <div style={{ gridColumn: "1/-1" }}><CreateDealForm onSubmit={handleCreateDeal} disabled={pending}/></div>}
          </>
        )}

        {/* Seller — submit data, stage 0 */}
        {isSeller && deal && stage === 0 && (
          <div className="nameInputBox" style={{ gridColumn: "1/-1" }}>
            <label>ФИО продавца</label>
            <input value={sellerName} onChange={e => setSellerName(e.target.value)} placeholder="Ivan Petrov"/>
            <label style={{ marginTop: 10 }}>Хеш паспорта</label>
            <input value={sellerPassport} onChange={e => setSellerPassport(e.target.value)} placeholder="hash_..."/>
            <button className="action-btn action-btn--orange" disabled={pending} style={{ marginTop: 12, width: "100%" }}
              onClick={() => runTx(c => c.submitSellerData(dealId, sellerName, sellerPassport),
                "✍️ Данные продавца отправлены. Оракул проверяет право собственности в реестре...",
                "Ожидаем ответ оракула...")}>
              <span className="action-btn__num">1</span>
              <span className="action-btn__text"><strong>Подать данные продавца</strong><small>Оракул проверит в реестре</small></span>
            </button>
          </div>
        )}

        {/* Open deal by ID */}
        {account && !deal && contract && (
          <div className="nameInputBox" style={{ gridColumn: "1/-1" }}>
            <label>ID сделки (спросить у продавца)</label>
            <input type="number" placeholder="0"
              onChange={e => { const id = Number(e.target.value); if (!isNaN(id) && e.target.value !== "") { setDealId(id); loadDeal(contract, id); }}}/>
          </div>
        )}

        {/* Buyer — submit data, stage 2. If buyer is not assigned yet, any non-seller account can join. */}
        {(isBuyer || canJoinAsBuyer) && deal && stage === 2 && (
          <div className="nameInputBox" style={{ gridColumn: "1/-1" }}>
            <label>ФИО покупателя</label>
            <input value={buyerName} onChange={e => setBuyerName(e.target.value)} placeholder="Kristina Maykushina"/>
            <label style={{ marginTop: 10 }}>Хеш паспорта</label>
            <input value={buyerPassport} onChange={e => setBuyerPassport(e.target.value)} placeholder="hash_..."/>
            <button className="action-btn action-btn--blue" disabled={pending} style={{ marginTop: 12, width: "100%" }}
              onClick={() => runTx(c => c.submitBuyerData(dealId, buyerName, buyerPassport),
                "🔍 Данные покупателя отправлены. Оракул проверяет личность...",
                "Ожидаем ответ оракула...")}>
              <span className="action-btn__num">2</span>
              <span className="action-btn__text"><strong>Подать данные покупателя</strong><small>Оракул проверит личность</small></span>
            </button>
          </div>
        )}

        {/* Buyer — reserve payment, stage 4 */}
        {isBuyer && deal && stage === 4 && (
          <button className="action-btn action-btn--green" style={{ gridColumn: "1/-1" }} disabled={pending}
            onClick={() => runTx(c => c.reservePayment(dealId, { value: deal.price }),
              "💰 Деньги переходят в escrow смарт-контракта...",
              "Деньги зарезервированы в escrow. Ожидаем подтверждение переписи права собственности...")}>
            <span className="action-btn__num">3</span>
            <span className="action-btn__text">
              <strong>Отправить оплату в escrow</strong>
              <small>{priceEth} ETH → смарт-контракт</small>
            </span>
          </button>
        )}

        {/* Cancel */}
        {deal && !isCompleted && !isCancelled && stage < 6 && isSeller && (
          <button className="action-btn action-btn--red danger" disabled={pending}
            onClick={() => runTx(c => c.cancelDeal(dealId, "Отменено продавцом"), "❌ Отмена...", "Сделка отменена.")}>
            <span className="action-btn__num">✕</span>
            <span className="action-btn__text"><strong>Отменить сделку</strong><small>Продавец отменяет</small></span>
          </button>
        )}

        {deal && !isCompleted && !isCancelled && stage === 4 && isBuyer && (
          <button className="action-btn action-btn--red danger" disabled={pending}
            onClick={() => runTx(c => c.cancelDealAsBuyer(dealId, "Отменено покупателем"), "❌ Отмена...", "Сделка отменена.")}>
            <span className="action-btn__num">✕</span>
            <span className="action-btn__text"><strong>Отменить сделку</strong><small>Покупатель отменяет</small></span>
          </button>
        )}

        {deal && stage === 4 && isSeller && paymentPassed && (
          <button className="action-btn action-btn--purple" disabled={pending}
            onClick={() => runTx(c => c.claimTimeoutCancellation(dealId), "⏱ Срок истёк...", "Отменена по сроку.")}>
            <span className="action-btn__num">⏱</span>
            <span className="action-btn__text"><strong>Истёк срок оплаты</strong><small>Вернуть сертификат</small></span>
          </button>
        )}

        {/* Refresh button */}
        {deal && (
          <button className="action-btn action-btn--blue" disabled={pending}
            onClick={() => loadDeal(contract, dealId)}>
            <span className="action-btn__num">↻</span>
            <span className="action-btn__text"><strong>Обновить данные</strong><small>Перечитать из контракта</small></span>
          </button>
        )}
<section className={`messageBox ${pending || isAnimating ? "messageBox--pending" : ""}`}>
        <strong>{pending ? "⏳ Выполняется..." : isAnimating ? "🎬 Анимация..." : "Что происходит:"}</strong>
        <p>{message}</p>
        {(pending || isAnimating) && <div className="messageBox__pulse"/>}
      </section>
      </aside>
      </section>

      {deal && (
        <section className="details">
          <h2>Данные сделки #{deal.id}</h2>
          <div className="grid">
            <p><span>Цена</span>{priceEth} ETH</p>
            <p><span>Продавец</span>{shortAddr(deal.seller)}</p>
            <p><span>Покупатель</span>{!isZeroAddress(deal.buyer) ? shortAddr(deal.buyer) : "не назначен"}</p>
            <p><span>Этап</span>{STAGES[stage]}</p>
            <p><span>ФИО продавца</span>{deal.sellerFullName || "—"}</p>
            <p><span>ФИО покупателя</span>{deal.buyerFullName || "—"}</p>
            <p><span>Кадастровый №</span>{deal.cadastralNumber}</p>
            <p><span>Адрес объекта</span>{deal.apartmentAddress}</p>
            <p><span>ID в реестре (до)</span>{deal.registryRecordId || "—"}</p>
            <p><span>ID в реестре (после)</span>{deal.newRegistryRecordId || "—"}</p>
            <p><span>Срок оплаты</span>{fmtTime(deal.paymentDeadline)}</p>
            <p><span>Осталось</span>{stage === 4 ? fmtSec(secToDeadline) : "—"}</p>
            <p><span>Создана</span>{fmtTime(deal.createdAt)}</p>
            <p><span>Завершена</span>{fmtTime(deal.completedAt)}</p>
            {deal.lastOracleError && <p style={{ gridColumn:"1/-1", background:"#fef2f2", borderColor:"#fca5a5" }}><span>Ошибка оракула</span>{deal.lastOracleError}</p>}
          </div>
        </section>
      )}

      {isCertOpen && (
        <div className="modalBackdrop" onClick={() => setIsCertOpen(false)}>
          <div className="modalCard" onClick={e => e.stopPropagation()}>
            <div className="modalHeader"><h2>📄 Сертификат</h2><button onClick={() => setIsCertOpen(false)}>×</button></div>
            <pre className="contractPreview">{`Объект: ${deal?.apartmentAddress || "—"}
Кадастровый: ${deal?.cadastralNumber || "—"}
Цена: ${priceEth} ETH
Продавец: ${deal?.sellerFullName || "—"} (${shortAddr(deal?.seller)})
Покупатель: ${deal?.buyerFullName || "—"} (${shortAddr(deal?.buyer)})
Этап: ${STAGES[stage]}
ID реестра (новый): ${deal?.newRegistryRecordId || "ожидание..."}
Завершена: ${fmtTime(deal?.completedAt)}`}</pre>
            <div className="modalActions"><button onClick={() => setIsCertOpen(false)}>Закрыть</button></div>
          </div>
        </div>
      )}
    </main>
  );
}
