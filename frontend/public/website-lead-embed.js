/**
 * Vidushi Infotech — universal website lead-capture snippet.
 *
 * Usage: paste this on the page with your contact form —
 *   <script src="https://app.vidushiinfotech.com/website-lead-embed.js"
 *           data-webhook="YOUR_WEBHOOK_URL"
 *           data-form-id="YOUR_FORM_ID"></script>
 *
 * Progressively enhances the page's <form> (or the one matching
 * [data-vidushi-form] if you have more than one) — on submit, it sends a copy
 * of the form data to Vidushi in the background and lets the form's own
 * submit/redirect behavior continue exactly as before. If this script is
 * blocked (some site builders disallow custom <script> tags), connect your
 * form tool to Zapier/Make instead and point its webhook step at the same URL.
 */
(function () {
  var thisScript = document.currentScript;
  var webhookUrl = thisScript && thisScript.getAttribute("data-webhook");
  var formId = (thisScript && thisScript.getAttribute("data-form-id")) || "";

  if (!webhookUrl) {
    console.warn("[vidushi] website-lead-embed.js: missing data-webhook attribute");
    return;
  }

  function attach() {
    var form = document.querySelector("[data-vidushi-form]") || document.querySelector("form");
    if (!form) return;

    form.addEventListener("submit", function () {
      try {
        var data = {};
        new FormData(form).forEach(function (value, key) {
          data[key] = value;
        });
        data.form_id = formId;

        fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
          keepalive: true,
        }).catch(function () {
          /* best-effort — never block the page's own form submission */
        });
      } catch (e) {
        console.warn("[vidushi] website-lead-embed.js failed to capture lead:", e);
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", attach);
  } else {
    attach();
  }
})();
