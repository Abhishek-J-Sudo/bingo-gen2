const BingoDialog = (() => {
    const overlay = document.getElementById("dialogOverlay");
    const titleEl = document.getElementById("dialogTitle");
    const messageEl = document.getElementById("dialogMessage");
    const confirmBtn = document.getElementById("dialogConfirm");
    const cancelBtn = document.getElementById("dialogCancel");

    let activeResolve = null;

    function close(result) {
        if (!overlay || !activeResolve) return;

        overlay.classList.remove("active");
        overlay.setAttribute("aria-hidden", "true");

        const resolve = activeResolve;
        activeResolve = null;
        resolve(result);
    }

    function open({ title = "Notice", message = "", confirmText = "OK", cancelText = "Cancel", showCancel = false, tone = "notice" } = {}) {
        if (!overlay || !titleEl || !messageEl || !confirmBtn || !cancelBtn) {
            return Promise.resolve(!showCancel);
        }

        if (activeResolve) close(false);

        titleEl.textContent = title;
        messageEl.textContent = message;
        confirmBtn.textContent = confirmText;
        cancelBtn.textContent = cancelText;
        cancelBtn.hidden = !showCancel;
        overlay.classList.toggle("confirm", showCancel);
        overlay.dataset.tone = tone;

        overlay.classList.add("active");
        overlay.setAttribute("aria-hidden", "false");
        confirmBtn.focus();

        return new Promise((resolve) => {
            activeResolve = resolve;
        });
    }

    confirmBtn?.addEventListener("click", () => { window.BingoSounds?.dialogConfirm(); close(true); });
    cancelBtn?.addEventListener("click", () => { window.BingoSounds?.dialogCancel(); close(false); });

    overlay?.addEventListener("click", (event) => {
        if (event.target === overlay && !cancelBtn.hidden) close(false);
    });

    document.addEventListener("keydown", (event) => {
        if (!overlay?.classList.contains("active")) return;
        if (event.key === "Escape" && !cancelBtn.hidden) close(false);
        if (event.key === "Enter") close(true);
    });

    return {
        alert(message, title = "Notice") {
            return open({ title, message, confirmText: "OK" });
        },

        warning(message, title = "Warning") {
            return open({ title, message, confirmText: "OK", tone: "warning" });
        },

        confirm(message, title = "Confirm") {
            return open({ title, message, confirmText: "Yes", cancelText: "No", showCancel: true, tone: "confirm" });
        }
    };
})();

window.BingoDialog = BingoDialog;
