const prayers = window.recoveryPrayers || [];
function displayDailyPrayer() {
  const today = new Date();

  const startOfYear = new Date(
    today.getFullYear(), 0, 1
  );

  const dayOfYear = Math.floor(
    (Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) -
     Date.UTC(startOfYear.getFullYear(), 0, 1)) / 86400000
  );

  const prayerIndex = dayOfYear % prayers.length;

  const prayerText = document.getElementById("daily-prayer-text");
  const prayerDate = document.getElementById("daily-prayer-date");

  if (prayerText) {
    prayerText.textContent = prayers[prayerIndex];
  }

  if (prayerDate) {
    prayerDate.textContent = today.toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric"
    });
  }
}

document.addEventListener("DOMContentLoaded", displayDailyPrayer);