(function () {
  "use strict";

  var button = document.querySelector(".crypto-copy");
  if (!button) return;

  var status = document.querySelector(".crypto-status");
  var address = button.getAttribute("data-address");
  var display = document.getElementById(button.getAttribute("data-copy-target"));
  var timer;

  function report(message, isError) {
    status.textContent = message;
    status.classList.toggle("is-error", Boolean(isError));
    clearTimeout(timer);
    timer = setTimeout(function () { status.textContent = ""; }, 6000);
  }

  function selectAddress() {
    var range = document.createRange();
    range.selectNodeContents(display);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function fallbackCopy() {
    var area = document.createElement("textarea");
    area.value = address;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.top = "0";
    area.style.opacity = "0";
    area.style.fontSize = "16px";
    document.body.appendChild(area);
    area.select();
    area.setSelectionRange(0, address.length);
    var ok = false;
    try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
    document.body.removeChild(area);
    return ok;
  }

  function failed() {
    selectAddress();
    report("Copy failed. The address is selected; please copy it manually.", true);
  }

  button.addEventListener("click", function () {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(address).then(function () {
        report("Wallet address copied to clipboard.");
      }, function () {
        if (fallbackCopy()) report("Wallet address copied to clipboard.");
        else failed();
      });
    } else if (fallbackCopy()) {
      report("Wallet address copied to clipboard.");
    } else {
      failed();
    }
  });
})();
