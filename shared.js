// Shared code of the rank mod's chart pages (rank-history.html, playstyle.html). The game shows these pages in a
// visible html panel blended with "screen", so their pure black background is see-through; it reads nothing but the
// page title: <prefix>{"q": request id, "k": "ready" | "empty" | "error"}.
// The pages share the browser storage with the bridge page (same site), so what it already loaded shows at once.
var DLRPage = (function () {
	var API = "https://api.deadlock-api.com";
	var KEEP_MS = 60 * 24 * 3600 * 1000;

	// the job comes in the part after "#" (the game only changes that part between players)
	function params() {
		return new URLSearchParams(location.hash.slice(1) || location.search.slice(1));
	}

	function tell(P, kind) {
		try { document.title = (P.get("p") || "") + JSON.stringify({ q: Number(P.get("q")), k: kind }); } catch (e) { }
	}

	function esc(s) {
		return String(s).replace(/[&<>"']/g, function (c) { return "&#" + c.charCodeAt(0) + ";"; });
	}

	// ---------- storage ----------

	function read(key, ttl) {
		try {
			var e = JSON.parse(localStorage.getItem(key) || "null");
			return e && Date.now() - e.at < (ttl || KEEP_MS) ? e : null;
		} catch (x) {
			return null;
		}
	}

	function write(key, value) {
		value.at = Date.now();
		try { localStorage.setItem(key, JSON.stringify(value)); } catch (x) { }
	}

	// ---------- requests (with the bridge page's 429 cooldown) ----------

	var COOLDOWN_PREFIX = "dlr_cool_";

	function cooldownLeft(family) {
		try { return Math.max(0, Number(JSON.parse(localStorage.getItem(COOLDOWN_PREFIX + family) || "0")) - Date.now()); } catch (e) { return 0; }
	}

	function get(path, family) {
		var left = family ? cooldownLeft(family) : 0;
		if (left > 0) return Promise.reject("cooldown " + Math.ceil(left / 1000) + "s");
		return fetch(API + path).then(function (r) {
			if (r.status === 429 && family) {
				var s = 0;
				try { s = Number(r.headers.get("retry-after")); } catch (e) { s = 0; }
				if (!(s > 0)) s = 60;
				try { localStorage.setItem(COOLDOWN_PREFIX + family, JSON.stringify(Date.now() + Math.min(s, 3600) * 1000)); } catch (e) { }
			}
			return r.ok ? r.json() : Promise.reject("HTTP " + r.status);
		});
	}

	// ---------- ranks ----------
	// A badge is tier * 10 + subrank. Rank points: subrank s of tier t starts at (t - 1) * 7000 + (s - 1) * 1000; going
	// up a subrank takes 1000 points, from subrank VI to the next tier 2000. Eternus (tier 11) subranks are percentile
	// cuts instead, so they have no points range.

	var MAX_TIER = 11;
	var COLORS = ["#333333", "#6A3E1E", "#882355", "#5C6DAB", "#719C47", "#DDA326", "#EE4F57", "#B47FEB", "#955138", "#7C7C7C", "#C39751", "#5CE9A9"];
	var ROMAN = ["", "I", "II", "III", "IV", "V", "VI"];

	function split(badge) {
		var t = Math.floor(badge / 10), s = badge % 10;
		return t >= 1 && t <= MAX_TIER && s >= 1 && s <= 6 ? [t, s] : null;
	}

	// { pts, need } inside the badge's subrank, or null (no rank, Eternus, points outside the badge)
	function progress(badge, fp) {
		var ts = split(badge);
		if (!ts || ts[0] >= MAX_TIER || typeof fp !== "number") return null;
		var start = (ts[0] - 1) * 7000 + (ts[1] - 1) * 1000, need = ts[1] === 6 ? 2000 : 1000;
		return fp >= start && fp < start + need ? { pts: fp - start, need: need } : null;
	}

	// The rank after each ranked match as one continuous number, tier bands of 6: (tier - 1) * 6 + (subrank - 1) +
	// share of the subrank's points. points: [[start time, badge, rank points the match gave], ...] oldest first;
	// last: [badge, rank points] now (from /rank). The points are worked out backwards from now with the matches' gains;
	// where that leaves the badge a match reported, the line takes up the badge's range again (a season reset, a match
	// missing from the history). Without points the line sits mid-subrank. Returns [[time, value, badge], ...].
	function curve(points, last) {
		var out = [], n = points.length;
		var fp = n && last && last[0] === points[n - 1][1] && typeof last[1] === "number" ? last[1] : null;
		for (var i = n - 1; i >= 0; i--) {
			var b = points[i][1], ts = split(b);
			if (!ts) { fp = null; continue; }
			var base = (ts[0] - 1) * 6 + (ts[1] - 1), share = 0.5;
			if (ts[0] < MAX_TIER) {
				var start = (ts[0] - 1) * 7000 + (ts[1] - 1) * 1000, need = ts[1] === 6 ? 2000 : 1000;
				if (fp !== null) {
					fp = Math.min(start + need - 1, Math.max(start, fp));
					share = (fp - start) / need;
					fp -= points[i][2] || 0;
				}
			} else {
				fp = null;
			}
			out.push([points[i][0], Math.round((base + share) * 1000) / 1000, b]);
		}
		return out.reverse();
	}

	// ---------- drawing ----------

	function r2(v) {
		return Math.round(v * 100) / 100;
	}

	// Fritsch-Carlson monotone cubic through points with increasing xs: smooth, never overshoots its neighbours
	function monotonePath(xs, ys) {
		var n = xs.length, i;
		if (!n) return "";
		if (n === 1) return "M" + r2(xs[0]) + "," + r2(ys[0]);
		var d = [], m = [];
		for (i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
		m.push(d[0]);
		for (i = 1; i < n - 1; i++) m.push(d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2);
		m.push(d[n - 2]);
		for (i = 0; i < n - 1; i++) {
			if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
			var a = m[i] / d[i], b = m[i + 1] / d[i], h = a * a + b * b;
			if (h > 9) { var k = 3 / Math.sqrt(h); m[i] = k * a * d[i]; m[i + 1] = k * b * d[i]; }
		}
		var p = "M" + r2(xs[0]) + "," + r2(ys[0]);
		for (i = 0; i < n - 1; i++) {
			var dx = (xs[i + 1] - xs[i]) / 3;
			p += " C" + r2(xs[i] + dx) + "," + r2(ys[i] + m[i] * dx) + " " + r2(xs[i + 1] - dx) + "," + r2(ys[i + 1] - m[i + 1] * dx) + " " + r2(xs[i + 1]) + "," + r2(ys[i + 1]);
		}
		return p;
	}

	// an API colour mixed 35% toward white, so dark tiers stay readable on the see-through background
	function lift(color) {
		var v = parseInt(String(color || "#ffffff").slice(1), 16);
		return "#" + [16, 8, 0].map(function (sh) {
			return ("0" + Math.round(((v >> sh) & 255) * 0.65 + 255 * 0.35).toString(16)).slice(-2);
		}).join("");
	}

	function message(text) {
		document.body.innerHTML = '<p class="msg">' + esc(text) + "</p>";
	}

	return {
		params: params, tell: tell, esc: esc, read: read, write: write, get: get, KEEP_MS: KEEP_MS,
		MAX_TIER: MAX_TIER, COLORS: COLORS, ROMAN: ROMAN, split: split, progress: progress, curve: curve,
		monotonePath: monotonePath, lift: lift, r2: r2, message: message
	};
})();
