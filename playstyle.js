// Data side of the playstyle radar (playstyle.html and the profile page's "playstyle" tab): six axes, each where the
// player's average of the last 30 days sits among everyone's averages of those days (0-100, 50 = the middle). Early
// impact: souls and kills + assists at 10:00 against the community at 10:00. A player with no match in 30 days is
// shown with all his matches against the same community (all: 1).
var DAY = 86400, WINDOW_DAYS = 30, EARLY_S = 600;
var COMMUNITY_MS = 6 * 3600 * 1000, PLAYER_MS = 30 * 60 * 1000;
var MODES = "&match_mode=ranked,unranked";
// clockwise from the top
var AXES = ["player_damage_per_min", "net_worth_per_min", "player_damage_taken_per_min", "player_healing_per_min", null, "boss_damage_per_min"];
var CURVE_FIELDS = ["net_worth_avg", "net_worth_std", "kills_avg", "kills_std", "assists_avg", "assists_std"];

function since() {
	return Math.floor(Date.now() / 1000 / DAY) * DAY - WINDOW_DAYS * DAY;
}

// only what the radar needs is kept: the 5 metrics, the curve samples around 10:00
function slimMetrics(d) {
	var out = {};
	AXES.forEach(function (f) { if (f && d && d[f]) out[f] = d[f]; });
	return out;
}

function slimCurve(list) {
	var pts = (list || []).filter(function (p) { return p && typeof p.game_time === "number"; }).sort(function (a, b) { return a.game_time - b.game_time; });
	var keep = [];
	for (var i = 0; i < pts.length; i++) {
		var near = pts[i].game_time <= EARLY_S ? (pts[i + 1] && pts[i + 1].game_time >= EARLY_S) : (pts[i - 1] && pts[i - 1].game_time <= EARLY_S);
		if (!near && pts[i].game_time !== EARLY_S) continue;
		var e = { game_time: pts[i].game_time };
		CURVE_FIELDS.forEach(function (f) { e[f] = pts[i][f]; });
		keep.push(e);
	}
	return keep;
}

function cached(key, ttl, load) {
	var c = DLRPage.read(key, ttl);
	if (c) return Promise.resolve(c.d);
	return load().then(function (d) {
		DLRPage.write(key, { d: d });
		return d;
	}, function (e) {
		// an old copy beats nothing
		var old = DLRPage.read(key);
		return old ? old.d : Promise.reject(e);
	});
}

function community() {
	var t = "&min_unix_timestamp=" + since();
	return Promise.all([
		cached("dlr_ps_comm", COMMUNITY_MS, function () { return DLRPage.get("/v1/analytics/player-stats/metrics?" + MODES.slice(1) + t, "analytics").then(slimMetrics); }),
		cached("dlr_ps_curve", COMMUNITY_MS, function () { return DLRPage.get("/v1/analytics/player-performance-curve?resolution=0" + MODES + t, "analytics").then(slimCurve); })
	]);
}

function hasData(m) {
	return AXES.some(function (f) { return f && m[f] && typeof m[f].avg === "number"; });
}

function player(acc) {
	function window_(t) {
		return Promise.all([
			DLRPage.get("/v1/analytics/player-stats/metrics?account_ids=" + acc + MODES + t, "analytics").then(slimMetrics),
			DLRPage.get("/v1/analytics/player-performance-curve?resolution=0&account_ids=" + acc + MODES + t, "analytics").then(slimCurve, function () { return []; })
		]);
	}
	return cached("dlr_ps_" + acc, PLAYER_MS, function () {
		return window_("&min_unix_timestamp=" + since()).then(function (r) {
			if (hasData(r[0])) return { m: r[0], c: r[1], all: 0 };
			// deadlock-api's analytics only keep recent matches; a player away for a while still has his per-hero
			// stats of all time (no healing or early game in them: those axes stay empty)
			return DLRPage.get("/v1/players/hero-stats?account_ids=" + acc).then(function (heroes) {
				return { m: heroAverages(heroes || []), c: [], all: 1 };
			});
		});
	});
}

// per-hero stats -> the radar's metrics, averaged over heroes by matches played
var HERO_FIELDS = { player_damage_per_min: "damage_per_min", net_worth_per_min: "networth_per_min", player_damage_taken_per_min: "damage_taken_per_min", boss_damage_per_min: "obj_damage_per_min" };

function heroAverages(heroes) {
	var out = {};
	Object.keys(HERO_FIELDS).forEach(function (f) {
		var sum = 0, n = 0;
		heroes.forEach(function (h) {
			var v = h[HERO_FIELDS[f]];
			if (typeof v !== "number" || !h.matches_played) return;
			sum += v * h.matches_played;
			n += h.matches_played;
		});
		if (n) out[f] = { avg: sum / n };
	});
	return out;
}

// share (0-100) of value inside the community's percentile thresholds (linear between them)
function percentile(value, dist) {
	var at = [1, 5, 10, 25, 50, 75, 90, 95, 99], prev = null;
	if (!dist || typeof value !== "number") return null;
	for (var i = 0; i < at.length; i++) {
		var v = dist["percentile" + at[i]];
		if (typeof v !== "number") return null;
		if (value < v) {
			if (prev === null) return at[0];
			return prev[1] === v ? prev[0] : prev[0] + (at[i] - prev[0]) * (value - prev[1]) / (v - prev[1]);
		}
		prev = [at[i], v];
	}
	return at[at.length - 1];
}

// standard normal CDF (Abramowitz-Stegun 7.1.26)
function cdf(z) {
	if (z < 0) return 1 - cdf(-z);
	var x = z / Math.SQRT2, t = 1 / (1 + 0.3275911 * x);
	var poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
	return 0.5 * (1 + (1 - poly * Math.exp(-x * x)));
}

function at10(curve) {
	var before = null, after = null;
	(curve || []).forEach(function (p) {
		if (p.game_time <= EARLY_S && (!before || p.game_time > before.game_time)) before = p;
		if (p.game_time >= EARLY_S && (!after || p.game_time < after.game_time)) after = p;
	});
	if (!before || !after) return null;
	var k = after.game_time === before.game_time ? 0 : (EARLY_S - before.game_time) / (after.game_time - before.game_time), out = {};
	for (var i = 0; i < CURVE_FIELDS.length; i++) {
		var f = CURVE_FIELDS[i];
		if (typeof before[f] !== "number" || typeof after[f] !== "number") return null;
		out[f] = before[f] + (after[f] - before[f]) * k;
	}
	return out;
}

function early(mine, all) {
	var p = at10(mine), c = at10(all);
	if (!p || !c || !(c.net_worth_std > 0)) return null;
	var kaStd = Math.sqrt(c.kills_std * c.kills_std + c.assists_std * c.assists_std);
	if (!(kaStd > 0)) return null;
	var souls = cdf((p.net_worth_avg - c.net_worth_avg) / c.net_worth_std);
	var ka = cdf((p.kills_avg + p.assists_avg - c.kills_avg - c.assists_avg) / kaStd);
	return Math.min(99, Math.max(1, (souls + ka) / 2 * 100));
}

function scores(pl, comm) {
	return AXES.map(function (f) {
		if (!f) return early(pl.c, comm[1]);
		var m = pl.m[f];
		return m && typeof m.avg === "number" ? percentile(m.avg, comm[0][f]) : null;
	});
}

// DLRStyle.load(acc) -> { sc: [6 scores or null], all: 0 | 1 }
var DLRStyle = {
	load: function (acc) {
		return Promise.all([player(acc), community()]).then(function (r) { return { sc: scores(r[0], r[1]), all: r[0].all || 0 }; });
	}
};
