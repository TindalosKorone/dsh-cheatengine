window.__ModuleLoader__.load({
	id: "@tindalosko/dsh-cheatengine",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		//#region src/client/index.ts
		/**
		* @tindalosko/dsh-cheatengine — client floating status panel.
		* Registered on the `shell.overlay` slot. Polls `/ce-status/api` every 2s
		* and renders a minimal human-readable summary. Non-blocking.
		*
		* The panel is optional: it can be closed with × and reopened via a small
		* floating "🧊 CE" button. The choice is persisted in localStorage.
		*/
		const inject = ["slots"];
		const STORAGE_KEY = "dsh-ce-panel-hidden";
		function readHidden() {
			try {
				return localStorage.getItem(STORAGE_KEY) === "1";
			} catch {
				return false;
			}
		}
		function writeHidden(hidden) {
			try {
				localStorage.setItem(STORAGE_KEY, hidden ? "1" : "0");
			} catch {}
		}
		function row(label, value) {
			return (0, react.createElement)("div", { style: {
				display: "flex",
				justifyContent: "space-between",
				padding: "2px 0"
			} }, (0, react.createElement)("span", null, label), (0, react.createElement)("b", null, String(value ?? "-")));
		}
		function Panel() {
			const [data, setData] = (0, react.useState)({});
			const [hidden, setHidden] = (0, react.useState)(readHidden);
			(0, react.useEffect)(() => {
				if (hidden) return;
				let alive = true;
				function tick() {
					fetch("/ce-status/api").then((r) => r.json()).then((d) => {
						if (alive) setData(d);
					}).catch(() => {});
				}
				tick();
				const timer = setInterval(tick, 2e3);
				return () => {
					alive = false;
					clearInterval(timer);
				};
			}, [hidden]);
			const reopenStyle = {
				position: "fixed",
				right: 16,
				bottom: 16,
				zIndex: 99999,
				border: "1px solid var(--dsw-alias-border-l2, #333)",
				background: "var(--dsw-alias-bg-layer-3, #1c1c1c)",
				color: "var(--dsw-alias-label-primary, #eee)",
				borderRadius: 12,
				padding: "8px 12px",
				font: "12px/1.5 system-ui",
				cursor: "pointer",
				boxShadow: "var(--dsw-shadow-lv1, 0 8px 30px rgba(0,0,0,.4))"
			};
			if (hidden) return (0, react.createElement)("button", {
				id: "dsh-ce-status-reopen",
				style: reopenStyle,
				onClick: () => {
					setHidden(false);
					writeHidden(false);
				}
			}, "🧊 CE");
			return (0, react.createElement)("div", {
				id: "dsh-ce-status-panel",
				style: {
					position: "fixed",
					right: 16,
					bottom: 16,
					zIndex: 99999,
					width: 260,
					background: "var(--dsw-alias-bg-layer-3, #1c1c1c)",
					color: "var(--dsw-alias-label-primary, #eee)",
					border: "1px solid var(--dsw-alias-border-l2, #333)",
					borderRadius: 12,
					padding: "12px 14px",
					font: "12px/1.5 system-ui",
					boxShadow: "var(--dsw-shadow-lv1, 0 8px 30px rgba(0,0,0,.4))"
				}
			}, (0, react.createElement)("button", {
				"aria-label": "Close CE status panel",
				style: {
					position: "absolute",
					top: 6,
					right: 10,
					cursor: "pointer",
					color: "var(--dsw-alias-label-tertiary, #999)",
					border: "none",
					background: "transparent",
					fontSize: 16,
					lineHeight: 1
				},
				onClick: () => {
					setHidden(true);
					writeHidden(true);
				}
			}, "×"), (0, react.createElement)("h3", { style: {
				margin: "0 0 8px",
				fontSize: 13
			} }, "🧊 CE Status"), row("Phase", data.phase), row("Calls", data.call_count), row("Scan", data.scan_count), row("Locks", data.locked_addresses ? data.locked_addresses.length : 0), (0, react.createElement)("div", { style: {
				marginTop: 8,
				paddingTop: 8,
				borderTop: "1px solid var(--dsw-alias-border-l2, #333)"
			} }, (0, react.createElement)("div", { style: {
				fontWeight: 600,
				marginBottom: 4
			} }, "总结"), (0, react.createElement)("div", { style: {
				color: "var(--dsw-alias-label-tertiary, #999)",
				whiteSpace: "pre-wrap"
			} }, data.summary || "暂无总结。运行 ce_analyst 可生成。"), data.recent_events && data.recent_events.length > 0 ? (0, react.createElement)("div", { style: {
				marginTop: 6,
				color: "var(--dsw-alias-label-tertiary, #999)"
			} }, (0, react.createElement)("div", { style: {
				fontWeight: 600,
				marginBottom: 2
			} }, "最近"), ...data.recent_events.slice(0, 5).map((e) => (0, react.createElement)("div", {
				key: e.ts ?? e.text,
				style: {
					whiteSpace: "nowrap",
					overflow: "hidden",
					textOverflow: "ellipsis"
				}
			}, `• ${e.text}`))) : null));
		}
		function apply(ctx) {
			ctx.effect(() => ctx.slots.inject("shell.overlay", () => ctx.slots.register({
				name: "shell.overlay",
				id: "@tindalosko/dsh-cheatengine-panel",
				label: () => "CE Status"
			}, Panel)), "@tindalosko/dsh-cheatengine: status panel");
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map