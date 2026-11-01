
const tg = window.Telegram?.WebApp;
tg?.ready();
tg?.expand();

const content = document.getElementById("content");

function showPage(page) {
  const pages = {
    home: "<h2>🏠 Home</h2><p>Welcome to Earnora!</p>",
    tasks: "<h2>📋 Tasks</h2><p>Available tasks will appear here.</p>",
    ads: "<h2>▶ Watch Ads</h2><p>Daily limit: 100 ads.</p>",
    referral: "<h2>👥 Referral</h2><p>Reward: $0.10 per verified referral.</p>",
    profile: "<h2>👤 Profile</h2><p>Minimum withdrawal: $1.00</p>"
  };

  content.innerHTML = pages[page] || pages.home;
}

async function loadAccount() {
  if (!tg?.initData) {
    content.innerHTML =
      "<h2>Open Earnora inside Telegram</h2>";
    return;
  }

  try {
    const response = await fetch("/api/me", {
      headers: {
        "X-Telegram-Init-Data": tg.initData
      }
    });

    if (!response.ok) throw new Error("Authentication failed");

    const data = await response.json();

    document.getElementById("balance").textContent =
      "$" + data.balance;
  } catch (error) {
    content.innerHTML = "<p>Unable to load your account.</p>";
  }
}

loadAccount();
showPage("home");
