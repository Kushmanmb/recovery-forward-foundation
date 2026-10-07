const statusForm = document.getElementById("status-form");
const statusMessage = document.getElementById("status-message");

if (statusForm) {
  statusForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const input = document.getElementById("rcgi-id");
    const value = input.value.trim().toLowerCase();

    const validFormat = /^rcgi-[0-9a-f]{12}$/.test(value);

    if (!validFormat) {
      statusMessage.textContent =
        "Enter a valid RCGI ID in the format RCGI-XXXXXXXXXXXX.";
      return;
    }

    const participantId = `RCGI-${value.slice(5)}`;

    statusMessage.textContent = "Checking status...";

    try {
      const response = await fetch(
        `https://api.recoveryforwardfoundation.org/status/${encodeURIComponent(participantId)}`
      );

      if (response.status === 404) {
        statusMessage.textContent =
          "No application was found for that RCGI ID. Check the ID and try again.";
        return;
      }

      if (!response.ok) {
        throw new Error("Status lookup failed");
      }

      const result = await response.json();
      const readableStatus = result.status.replaceAll("_", " ");

      statusMessage.textContent =
        `Status: ${readableStatus}. Grant eligible: ${result.grantEligible ? "Yes" : "No"}.`;
    } catch {
      statusMessage.textContent =
        "We could not check your status right now. Please try again later.";
    }
  });
}