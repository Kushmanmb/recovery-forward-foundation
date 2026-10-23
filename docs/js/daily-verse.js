(() => {
  "use strict";
  // King James Version. Local collection keeps the verse available without an API.
  const verses = [
  [
    "Philippians 4:13",
    "I can do all things through Christ which strengtheneth me."
  ],
  [
    "Psalm 46:1",
    "God is our refuge and strength, a very present help in trouble."
  ],
  [
    "Psalm 56:3",
    "What time I am afraid, I will trust in thee."
  ],
  [
    "1 Peter 5:7",
    "Casting all your care upon him; for he careth for you."
  ],
  [
    "Psalm 23:1",
    "The LORD is my shepherd; I shall not want."
  ],
  [
    "Romans 12:12",
    "Rejoicing in hope; patient in tribulation; continuing instant in prayer;"
  ],
  [
    "Psalm 147:3",
    "He healeth the broken in heart, and bindeth up their wounds."
  ],
  [
    "Matthew 11:28",
    "Come unto me, all ye that labour and are heavy laden, and I will give you rest."
  ],
  [
    "Psalm 119:105",
    "Thy word is a lamp unto my feet, and a light unto my path."
  ],
  [
    "Proverbs 3:5",
    "Trust in the LORD with all thine heart; and lean not unto thine own understanding."
  ],
  [
    "Proverbs 3:6",
    "In all thy ways acknowledge him, and he shall direct thy paths."
  ],
  [
    "Psalm 34:18",
    "The LORD is nigh unto them that are of a broken heart; and saveth such as be of a contrite spirit."
  ],
  [
    "Isaiah 40:29",
    "He giveth power to the faint; and to them that have no might he increaseth strength."
  ],
  [
    "2 Corinthians 5:7",
    "(For we walk by faith, not by sight:)"
  ],
  [
    "Psalm 118:24",
    "This is the day which the LORD hath made; we will rejoice and be glad in it."
  ],
  [
    "Romans 8:31",
    "What shall we then say to these things? If God be for us, who can be against us?"
  ],
  [
    "Psalm 121:2",
    "My help cometh from the LORD, which made heaven and earth."
  ],
  [
    "Hebrews 11:1",
    "Now faith is the substance of things hoped for, the evidence of things not seen."
  ],
  [
    "Psalm 30:5",
    "For his anger endureth but a moment; in his favour is life: weeping may endure for a night, but joy cometh in the morning."
  ],
  [
    "Galatians 6:9",
    "And let us not be weary in well doing: for in due season we shall reap, if we faint not."
  ],
  [
    "Psalm 55:22",
    "Cast thy burden upon the LORD, and he shall sustain thee: he shall never suffer the righteous to be moved."
  ],
  [
    "2 Timothy 1:7",
    "For God hath not given us the spirit of fear; but of power, and of love, and of a sound mind."
  ],
  [
    "Psalm 27:14",
    "Wait on the LORD: be of good courage, and he shall strengthen thine heart: wait, I say, on the LORD."
  ],
  [
    "Lamentations 3:23",
    "They are new every morning: great is thy faithfulness."
  ],
  [
    "Psalm 9:9",
    "The LORD also will be a refuge for the oppressed, a refuge in times of trouble."
  ],
  [
    "James 4:8",
    "Draw nigh to God, and he will draw nigh to you. Cleanse your hands, ye sinners; and purify your hearts, ye double minded."
  ],
  [
    "Psalm 37:5",
    "Commit thy way unto the LORD; trust also in him; and he shall bring it to pass."
  ],
  [
    "John 14:27",
    "Peace I leave with you, my peace I give unto you: not as the world giveth, give I unto you. Let not your heart be troubled, neither let it be afraid."
  ],
  [
    "Psalm 62:6",
    "He only is my rock and my salvation: he is my defence; I shall not be moved."
  ],
  [
    "1 Thessalonians 5:11",
    "Wherefore comfort yourselves together, and edify one another, even as also ye do."
  ],
  [
    "Psalm 31:24",
    "Be of good courage, and he shall strengthen your heart, all ye that hope in the LORD."
  ]
];
  const container = document.querySelector(".daily-verse");
  const text = document.getElementById("daily-verse-text");
  const copy = document.querySelector("[data-verse-copy]");
  if (!container || !text || !copy) return;
  const calendar = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "numeric", day: "numeric"
  });
  let currentDay;
  function updateVerse(now = new Date()) {
    const parts = Object.fromEntries(calendar.formatToParts(now).map(part => [part.type, part.value]));
    // Calendar-day arithmetic stays stable across daylight saving changes.
    const day = Math.floor(Date.UTC(+parts.year, +parts.month - 1, +parts.day) / 86400000);
    if (day === currentDay) return;
    currentDay = day;
    const [reference, verse] = verses[((day % verses.length) + verses.length) % verses.length];
    const value = "“" + verse + "” — " + reference + " (KJV)";
    text.textContent = value;
    copy.textContent = value;
    copy.hidden = false;
    measure();
    container.classList.add("is-ready");
  }
  function measure() {
    // Two equal copies travel exactly one copy width for a seamless loop.
    const width = Math.max(text.getBoundingClientRect().width, container.clientWidth);
    text.style.minWidth = container.clientWidth + "px";
    copy.style.minWidth = container.clientWidth + "px";
    container.style.setProperty("--verse-duration", Math.max(25, width / 38) + "s");
  }
  updateVerse();
  // Also update an already-open tab after midnight or after returning from sleep.
  window.setInterval(() => updateVerse(), 15000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) updateVerse();
  });
  window.addEventListener("pageshow", () => updateVerse());
  window.addEventListener("resize", measure);
  if (document.fonts) document.fonts.ready.then(measure);
})();
