/* ==========================================================================
   MealPlan DSS — landing page behaviour
   Vanilla JS only. Sections: nav toggle, scroll effects, PWA bits.
   The dashboard (app.html) has its own controller in app.js.
   ========================================================================== */

(function () {
  "use strict";

  /* ---------- Small helpers ---------- */

  var toastTimer = null;
  function showToast(message) {
    var toast = document.getElementById("toast");
    if (!toast) return;
    toast.textContent = message;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toast.hidden = true;
    }, 3500);
  }

  /* ---------- Mobile nav toggle ---------- */

  var navToggle = document.getElementById("nav-toggle");
  var siteNav = document.getElementById("site-nav");

  if (navToggle && siteNav) {
    navToggle.addEventListener("click", function () {
      var open = navToggle.getAttribute("aria-expanded") === "true";
      navToggle.setAttribute("aria-expanded", String(!open));
      siteNav.classList.toggle("is-open", !open);
    });

    siteNav.addEventListener("click", function (event) {
      if (event.target.closest("a")) {
        navToggle.setAttribute("aria-expanded", "false");
        siteNav.classList.remove("is-open");
      }
    });
  }

  /* ---------- Sticky header shadow ---------- */

  var header = document.querySelector(".site-header");
  if (header) {
    var onScroll = function () {
      header.style.boxShadow =
        window.scrollY > 8 ? "0 4px 12px -8px rgba(44,53,36,0.25)" : "none";
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }

  /* ---------- Scroll reveal ---------- */

  var revealEls = document.querySelectorAll(".reveal");

  if (revealEls.length && "IntersectionObserver" in window) {
    var revealObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          revealObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12 });
    revealEls.forEach(function (el) { revealObserver.observe(el); });
  } else {
    revealEls.forEach(function (el) { el.classList.add("is-visible"); });
  }

  /* ---------- PWA: install prompt + service worker ---------- */

  window.addEventListener("beforeinstallprompt", function (event) {
    event.preventDefault();
    showToast("You can install MealPlan DSS — look for the install icon in your browser.");
  });

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("service-worker.js").catch(function (err) {
        console.warn("Service worker registration failed:", err);
      });
    });
  }

  window.addEventListener("offline", function () {
    showToast("You are offline — the cached app is still available.");
  });
  window.addEventListener("online", function () {
    showToast("Back online.");
  });
})();
