const statusForm = document.getElementById("status-form");
const statusMessage = document.getElementById("status-message");

if (statusForm) {
  statusForm.addEventListener("submit", (event) => {
    event.preventDefault();

    const input = document.getElementById("rcgi-id");
    const value = input.value.trim().toUpperCase();

    const validFormat = /^RCGI-[0-9A-F]{12}$/.test(value);

    if (!validFormat) {
      statusMessage.textContent =
        "Enter a valid RCGI ID in the format RCGI-XXXXXXXXXXXX.";
      return;
    }

    statusMessage.textContent =
      "Status lookup will become available when the Recovery Grant Registry is connected.";
  });
}
