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

	// extra: more fields for the game (the rank history's seasons)
	function tell(P, kind, extra) {
		var msg = { q: Number(P.get("q")), k: kind };
		for (var k in extra || {}) if (Object.prototype.hasOwnProperty.call(extra, k)) msg[k] = extra[k];
		try { document.title = (P.get("p") || "") + JSON.stringify(msg); } catch (e) { }
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
	// A badge is tier * 10 + subrank. Rank points depend on the ranked season (its sub_rank_xp: the points of each
	// subrank step, the last one on to the next tier). Beta Season 1: 1000 per subrank, VI 2000, so a tier spans 7000;
	// Beta Season 2: VI 1500, a tier 6500. Subrank s of tier t starts at (t - 1) * span + the steps before s.
	// Eternus (tier 11) subranks are percentile cuts instead, so they have no points range.

	var MAX_TIER = 11;
	var COLORS = ["#333333", "#6A3E1E", "#882355", "#5C6DAB", "#719C47", "#DDA326", "#EE4F57", "#B47FEB", "#955138", "#7C7C7C", "#C39751", "#5CE9A9"];
	var ROMAN = ["", "I", "II", "III", "IV", "V", "VI"];

	// ranked seasons, oldest first: { n, name, start, end (unix s), xp: points per subrank step }. deadlock-api's list
	// (/v1/assets/ranked-seasons, kept a day) replaces this built-in copy once loaded.
	var SEASONS_KEY = "dlr_seasons", SEASONS_MS = 24 * 3600 * 1000;
	var BUILT_IN = [
		{ n: 1, name: "Beta Season 1", start: 1785430800, end: 1793908800, xp: [1000, 1000, 1000, 1000, 1000, 2000] },
		{ n: 2, name: "Beta Season 2", start: 1793908800, end: 1804802400, xp: [1000, 1000, 1000, 1000, 1000, 1500] }
	];
	var seasonList = null;

	function parseSeasons(list) {
		var out = [];
		(list || []).forEach(function (s) {
			var iv = (s.intervals || [])[0], info = (s.rank_info || []).filter(function (r) { return r.sub_rank_xp; })[0];
			var xp = info && info.sub_rank_xp;
			if (!iv || !(iv.start_timestamp > 0) || !xp || xp.length !== 6) return;
			var m = /(\d+)\s*$/.exec(s.name || s.class_name || "");
			out.push({ n: m ? Number(m[1]) : out.length + 1, name: s.name || "", start: iv.start_timestamp, end: iv.end_timestamp || 0, xp: xp.slice() });
		});
		return out.sort(function (a, b) { return a.start - b.start; });
	}

	function seasons() {
		if (seasonList) return seasonList;
		try {
			var e = JSON.parse(localStorage.getItem(SEASONS_KEY) || "null");
			if (e && e.list && e.list.length) seasonList = e.list;
		} catch (x) { }
		return seasonList || BUILT_IN;
	}

	// brings deadlock-api's season list (at most once a day); resolves either way
	function loadSeasons() {
		try {
			var e = JSON.parse(localStorage.getItem(SEASONS_KEY) || "null");
			if (e && e.list && e.list.length && Date.now() - e.at < SEASONS_MS) { seasonList = e.list; return Promise.resolve(seasonList); }
		} catch (x) { }
		if (typeof fetch !== "function") return Promise.resolve(seasons());
		return fetch(API + "/v1/assets/ranked-seasons").then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
			.then(function (list) {
				var got = parseSeasons(list);
				if (got.length) {
					seasonList = got;
					try { localStorage.setItem(SEASONS_KEY, JSON.stringify({ at: Date.now(), list: got })); } catch (x) { }
				}
				return seasons();
			}, function () { return seasons(); });
	}

	// the season a time (unix s) falls in: the latest one started by then (the first one for older times)
	function seasonAt(t) {
		var list = seasons(), cur = list[0];
		for (var i = 0; i < list.length; i++) if (list[i].start <= t) cur = list[i];
		return cur;
	}

	function nowS() {
		return Math.floor(Date.now() / 1000);
	}

	function split(badge) {
		var t = Math.floor(badge / 10), s = badge % 10;
		return t >= 1 && t <= MAX_TIER && s >= 1 && s <= 6 ? [t, s] : null;
	}

	// { start, need } rank points of a badge's subrank in a season, or null (no rank, Eternus)
	function range(badge, season) {
		var ts = split(badge);
		if (!ts || ts[0] >= MAX_TIER) return null;
		var xp = season.xp, span = 0, i, start;
		for (i = 0; i < 6; i++) span += xp[i];
		start = (ts[0] - 1) * span;
		for (i = 0; i < ts[1] - 1; i++) start += xp[i];
		return { start: start, need: xp[ts[1] - 1] };
	}

	// { pts, need } inside the badge's subrank, or null (no rank, Eternus, points outside the badge). t: when the
	// points were reached (unix s; picks the season), now by default.
	function progress(badge, fp, t) {
		var r = typeof fp === "number" ? range(badge, seasonAt(t || nowS())) : null;
		return r && fp >= r.start && fp < r.start + r.need ? { pts: fp - r.start, need: r.need } : null;
	}

	// The rank points after the newest of a season's matches, guessed from the matches alone: every match's points
	// (newest minus the gains since) have to sit in the badge it reported; going back from the newest match, the
	// possible range narrows until a match does not fit any more (a gain missing from the history). Middle of what
	// is left, or null.
	function guessLast(points, from, to, season) {
		var lo = -Infinity, hi = Infinity, since = 0;
		for (var i = to; i >= from; i--) {
			var r = range(points[i][1], season);
			if (!r) break;
			var l = Math.max(lo, r.start + since), h = Math.min(hi, r.start + r.need - 1 + since);
			if (l > h) break;
			lo = l;
			hi = h;
			since += points[i][2] || 0;
		}
		return isFinite(lo) && isFinite(hi) ? Math.round((lo + hi) / 2) : null;
	}

	// The rank after each ranked match as one continuous number, tier bands of 6: (tier - 1) * 6 + (subrank - 1) +
	// share of the subrank's points. points: [[start time, badge, rank points the match gave], ...] oldest first;
	// last: [badge, rank points] now (from /rank). Each season is worked out by itself (a new season resets the
	// points, and its scale can differ): backwards from the points of its newest match (now's, for the newest
	// season's, when the badges agree; else guessed with guessLast, unless noGuess) with the matches' gains; where
	// that leaves the badge a match reported, the line takes up the badge's range again (a match missing from the
	// history). Without points the line sits mid-subrank. Returns [[time, value, badge, season number], ...].
	function curve(points, last, noGuess) {
		var out = [], n = points.length, end = n - 1;
		while (end >= 0) {
			var season = seasonAt(points[end][0]), begin = end;
			while (begin > 0 && seasonAt(points[begin - 1][0]) === season) begin--;
			var fp = null;
			if (end === n - 1 && last && last[0] === points[end][1] && typeof last[1] === "number") fp = last[1];
			else if (!noGuess) fp = guessLast(points, begin, end, season);
			for (var i = end; i >= begin; i--) {
				var b = points[i][1], ts = split(b);
				if (!ts) { fp = null; continue; }
				var base = (ts[0] - 1) * 6 + (ts[1] - 1), share = 0.5, r = range(b, season);
				if (r) {
					if (fp !== null) {
						fp = Math.min(r.start + r.need - 1, Math.max(r.start, fp));
						share = (fp - r.start) / r.need;
						fp -= points[i][2] || 0;
					}
				} else {
					fp = null;
				}
				out.push([points[i][0], Math.round((base + share) * 1000) / 1000, b, season.n]);
			}
			end = begin - 1;
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
		seasons: seasons, loadSeasons: loadSeasons, seasonAt: seasonAt, range: range, parseSeasons: parseSeasons,
		monotonePath: monotonePath, lift: lift, r2: r2, message: message
	};
})();
