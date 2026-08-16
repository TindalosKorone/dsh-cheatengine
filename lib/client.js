window.__ModuleLoader__.load({
	id: "@dsh-external/dsh-cheatengine",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		//#region src/client/index.ts
		/**
		* @dsh-external/dsh-cheatengine — client floating status panel.
		* Registered on the `shell.overlay` slot. Polls `/ce-status/api` every 2s
		* and renders a minimal human-readable summary. Non-blocking.
		*/
		const inject = ["slots"];
		function row(label, value) {
			return (0, react.createElement)("div", { style: {
				display: "flex",
				justifyContent: "space-between",
				padding: "2px 0"
			} }, (0, react.createElement)("span", null, label), (0, react.createElement)("b", null, String(value ?? "-")));
		}
		function Panel() {
			const [data, setData] = (0, react.useState)({});
			(0, react.useEffect)(() => {
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
			}, []);
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
			}, (0, react.createElement)("h3", { style: {
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
			} }, data.summary || "暂无总结。运行 ce_analyst 可生成。")));
		}
		function apply(ctx) {
			ctx.effect(() => ctx.slots.inject("shell.overlay", () => ctx.slots.register({
				name: "shell.overlay",
				id: "@dsh-external/dsh-cheatengine-panel",
				label: () => "CE Status"
			}, Panel)), "@dsh-external/dsh-cheatengine: status panel");
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map