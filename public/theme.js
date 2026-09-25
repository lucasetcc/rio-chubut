try { document.documentElement.dataset.theme = localStorage.getItem("theme") || "dark"; } catch (e) { document.documentElement.dataset.theme = "dark"; }
