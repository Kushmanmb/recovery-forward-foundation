const prayers = [
  "Heavenly Father, give me strength for today, courage for tomorrow, and peace with yesterday. Help me keep moving forward. Amen.",

  "Lord, guide my steps toward healing. When the road feels difficult, remind me that progress is made one day at a time. Amen.",

  "God, help me release what I cannot change, embrace what I can, and find wisdom in every decision I make today. Amen.",

  "Heavenly Father, when I feel weak, remind me that asking for help is an act of courage. Surround me with hope and understanding. Amen.",

  "Lord, thank You for another sunrise and another opportunity to begin again. Help me choose recovery, kindness, and gratitude today. Amen.",

  "God, help me forgive myself for yesterday, believe in myself today, and trust that a brighter future is possible. Amen.",

  "Heavenly Father, protect those who are struggling, comfort those who feel alone, and strengthen everyone walking the road of recovery. Amen."
];

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