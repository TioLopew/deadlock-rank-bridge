// Data of the mod's profile page, drawn by the game itself (dlr_pv.js): the bridge page's "pv" job (bridge.html) asks
// deadlock-api and answers in small pieces through its title. Everything here keeps what it loaded in this browser's
// storage, so a profile opened again answers at once.
var DLRPV = (function () {
	"use strict";
	var MIN = 60 * 1000, HOUR = 60 * MIN, DAYMS = 24 * HOUR;

	// deadlock-api: one 429 cooldown for the page's requests ("pv"), and one more try a moment later on a network / 5xx
	// failure
	// (fresh: past the browser's own cache of the answer, which deadlock-api lets it keep 5 minutes)
	function api(path, fresh) {
		return DLRPage.get(path, "pv", fresh).catch(function (e) {
			if (/429|cooldown|HTTP 4\d\d/.test(String(e))) return Promise.reject(e);
			return new Promise(function (r) { setTimeout(r, 1200); }).then(function () { return DLRPage.get(path, "pv", fresh); });
		});
	}

	// ---------- match history ----------
	// compact, newest first: [match id, hero, start, duration s, match mode, game mode, win, k, d, a, souls, last hits,
	// denies, rank gain, badge, placement match, demotion protection used, left the match]
	var M = { id: 0, hero: 1, t: 2, dur: 3, mode: 4, gmode: 5, win: 6, k: 7, d: 8, a: 9, nw: 10, lh: 11, dn: 12, delta: 13, badge: 14, cal: 15, prot: 16, left: 17 };
	// Kept histories live on disk, in this browser's IndexedDB (DB_KEEP players, the ones not seen the longest go
	// first: a few hundred kB each at most); a browser without it keeps them in localStorage as before (up to MH_KEEP
	// within MH_BUDGET characters, the same entries profile.html keeps). A kept one shows at once (then the fresh one
	// replaces it) for MH_MAX_MS; within MH_FRESH_MS it is not asked again.
	var MH_PREFIX = "dlr_pv_mh_", MH_KEEP = 16, MH_BUDGET = 2500000, MH_FRESH_MS = 45 * 1000, MH_MAX_MS = 90 * DAYMS;
	var DB_NAME = "dlr", DB_STORE = "mh", DB_KEEP = 400, MEM_KEEP = 4;

	function compact(list) {
		var seen = {}, out = [];
		(list || []).forEach(function (m) {
			if (!m || seen[m.match_id]) return;
			seen[m.match_id] = 1;
			out.push([m.match_id, m.hero_id, m.start_time || 0, m.match_duration_s || 0, m.match_mode || 0, m.game_mode || 0,
				m.player_team === m.match_result ? 1 : 0, m.player_kills || 0, m.player_deaths || 0, m.player_assists || 0,
				m.net_worth || 0, m.last_hits || 0, m.denies || 0, typeof m.ranked_delta === "number" ? m.ranked_delta : null,
				m.ranked_display_badge || 0, m.ranked_calibration_match || 0, m.ranked_used_demotion_protection ? 1 : 0,
				m.abandoned_time_s > 0 ? 1 : 0]);
		});
		return out.sort(function (a, b) { return b[2] - a[2]; });
	}

	// the other players' kept histories, oldest first: [key, time kept, size] (the time is read off the start of the
	// text, {"at":..., so the big lists are not parsed)
	function otherHistories(acc) {
		var out = [];
		try {
			for (var i = 0; i < localStorage.length; i++) {
				var k = localStorage.key(i);
				if (k && k.indexOf(MH_PREFIX) === 0 && k !== MH_PREFIX + acc) {
					var text = localStorage.getItem(k) || "", at = /^\{"at":(\d+)/.exec(text);
					out.push([k, at ? Number(at[1]) : 0, text.length]);
				}
			}
		} catch (e) { }
		return out.sort(function (a, b) { return a[1] - b[1]; });
	}

	// ---------- disk (IndexedDB) ----------
	var IDB = null;
	try { IDB = typeof indexedDB !== "undefined" && indexedDB ? indexedDB : null; } catch (e) { IDB = null; }
	var dbWait = null;
	// the database, or null when this browser cannot open it (then localStorage it is)
	function db() {
		if (!IDB) return Promise.resolve(null);
		if (!dbWait) {
			dbWait = new Promise(function (ok) {
				var rq;
				try { rq = IDB.open(DB_NAME, 1); } catch (e) { return ok(null); }
				rq.onupgradeneeded = function () {
					try { rq.result.createObjectStore(DB_STORE).createIndex("at", "at"); } catch (e) { }
				};
				rq.onsuccess = function () { ok(rq.result); };
				rq.onerror = rq.onblocked = function () { ok(null); };
			});
			dbWait.then(function (d) { if (!d) IDB = null; });
		}
		return dbWait;
	}
	// a request's answer (null on any failure)
	function req(store, mode, fn) {
		return db().then(function (d) {
			if (!d) return null;
			return new Promise(function (ok) {
				try {
					var tx = d.transaction(DB_STORE, mode), r = fn(tx.objectStore(DB_STORE), tx);
					tx.oncomplete = function () { ok(r && "result" in r ? r.result : true); };
					tx.onerror = tx.onabort = function () { ok(null); };
				} catch (e) { ok(null); }
			});
		});
	}
	// past DB_KEEP players, the ones kept the longest ago go
	function diskTrim() {
		return req(DB_STORE, "readwrite", function (s) {
			var idx = s.index("at"), c = idx.count();
			c.onsuccess = function () {
				var extra = c.result - DB_KEEP;
				if (extra <= 0) return;
				var cur = idx.openKeyCursor();
				cur.onsuccess = function () {
					var k = cur.result;
					if (!k || extra-- <= 0) return;
					s.delete(k.primaryKey);
					k.continue();
				};
			};
		});
	}

	// the last few players asked for, also in memory (a profile asks for its history once per part it shows)
	var mem = [];
	function remember(acc, e) {
		mem = mem.filter(function (x) { return x[0] !== acc; });
		mem.unshift([acc, e]);
		if (mem.length > MEM_KEEP) mem.length = MEM_KEEP;
	}

	// what this browser keeps of a player's history: { at, d } or null (too old: null too). An entry from the
	// localStorage days moves to disk.
	function readKept(acc) {
		for (var i = 0; i < mem.length; i++) if (mem[i][0] === acc) return Promise.resolve(Date.now() - mem[i][1].at < MH_MAX_MS ? mem[i][1] : null);
		var old = DLRPage.read(MH_PREFIX + acc, MH_MAX_MS);
		if (!IDB) return Promise.resolve(old);
		return req(DB_STORE, "readonly", function (s) { return s.get(acc); }).then(function (e) {
			if (old && (!e || e.at < old.at)) {
				e = { at: old.at, d: old.d };
				diskPut(acc, e).then(function (ok) { if (ok) try { localStorage.removeItem(MH_PREFIX + acc); } catch (x) { } });
			} else if (old) {
				try { localStorage.removeItem(MH_PREFIX + acc); } catch (x) { }
			}
			if (!e || !e.d || Date.now() - e.at >= MH_MAX_MS) return null;
			remember(acc, e);
			return e;
		});
	}

	function diskPut(acc, e) {
		return req(DB_STORE, "readwrite", function (s) { s.put(e, acc); }).then(function (ok) {
			if (ok && Math.random() < 0.2) diskTrim();
			return ok;
		});
	}

	function keepHistory(acc, list) {
		var e = { at: Date.now(), d: list };
		if (IDB) {
			remember(acc, e);
			return diskPut(acc, e).then(function (ok) { if (!ok) keepLocal(acc, list); });
		}
		keepLocal(acc, list);
		return Promise.resolve();
	}

	function keepLocal(acc, list) {
		var text = JSON.stringify({ at: Date.now(), d: list });
		var others = otherHistories(acc), size = text.length;
		others.forEach(function (x) { size += x[2]; });
		for (var i = 0; i < others.length && (others.length - i >= MH_KEEP || size > MH_BUDGET); i++) {
			size -= others[i][2];
			try { localStorage.removeItem(others[i][0]); } catch (e) { }
		}
		try {
			localStorage.setItem(MH_PREFIX + acc, text);
		} catch (e) {
			otherHistories(acc).forEach(function (x) { try { localStorage.removeItem(x[0]); } catch (y) { } });
			try { localStorage.setItem(MH_PREFIX + acc, text); } catch (x) { }
		}
	}

	// one look-up per player at a time, shared by the jobs that want it
	var loading = {};
	function fetchHistory(acc) {
		if (!loading[acc]) {
			loading[acc] = api("/v1/players/" + acc + "/match-history", true).then(function (list) {
				var out = compact(list);
				keepHistory(acc, out);
				delete loading[acc];
				return out;
			}, function (e) {
				delete loading[acc];
				return Promise.reject(e);
			});
		}
		return loading[acc];
	}

	// { d: history, stale: true when a fresher one is being looked up } (wait: wait for that one; freshMs: how old a
	// kept one may be to count as fresh)
	function history(acc, wait, freshMs) {
		return readKept(acc).then(function (kept) {
			var fresh = kept && Date.now() - kept.at < (freshMs || MH_FRESH_MS);
			if (kept && (fresh || !wait)) {
				if (!fresh) fetchHistory(acc).catch(function () { });
				return { d: kept.d, stale: !fresh };
			}
			return fetchHistory(acc).then(function (d) { return { d: d, stale: false }; }, function (e) {
				return kept ? { d: kept.d, stale: false, failed: true } : Promise.reject(e);
			});
		});
	}

	// normal games: unranked / ranked / placement (the game's own count)
	function counted(m) {
		return m[M.gmode] === 1 && (m[M.mode] === 1 || m[M.mode] === 4 || m[M.mode] === 8);
	}

	// what a row says its mode is: 4 ranked, 1 unranked, 2 lobby, 3 bots, 7 hero labs, 8 placement, 9 street brawl, 0 other
	function modeCode(m) {
		if (m[M.gmode] === 4) return 9;
		return [1, 2, 3, 4, 7, 8].indexOf(m[M.mode]) >= 0 ? m[M.mode] : 0;
	}

	function matches(list, f) {
		return list.filter(function (m) {
			if (f.hero && m[M.hero] !== f.hero) return false;
			if (f.mode === "ranked" && m[M.mode] !== 4) return false;
			if (f.mode === "unranked" && !(m[M.mode] === 1 && m[M.gmode] === 1)) return false;
			if (f.mode === "other" && (m[M.mode] === 4 || (m[M.mode] === 1 && m[M.gmode] === 1))) return false;
			if (f.res === "w" && !m[M.win]) return false;
			if (f.res === "l" && m[M.win]) return false;
			if (f.season && DLRPage.seasonAt(m[M.t]).n !== f.season) return false;
			return true;
		});
	}

	// ranked win streak up to and including each ranked match: match id -> streak
	function streaks(list) {
		var out = {}, n = 0;
		list.slice().reverse().forEach(function (m) {
			if (m[M.mode] !== 4) return;
			n = m[M.win] && m[M.delta] > 0 ? n + 1 : 0;
			out[m[M.id]] = n;
		});
		return out;
	}

	// a row as the game draws it: [match id, hero, start, duration, mode code, win, k, d, a, souls, rank gain (null:
	// none), note (0, 1 placement, 2 demotion protection, n >= 3: ranked win streak of n), left the match]
	function row(m, st) {
		var note = 0;
		if (m[M.mode] === 4 && m[M.delta] !== null) {
			if (m[M.cal]) note = 1;
			else if (m[M.delta] < 0 && m[M.prot]) note = 2;
			else if (m[M.delta] > 0 && st[m[M.id]] >= 3) note = st[m[M.id]];
		}
		return [m[M.id], m[M.hero], m[M.t], m[M.dur], modeCode(m), m[M.win], m[M.k], m[M.d], m[M.a], m[M.nw],
			m[M.mode] === 4 ? m[M.delta] : null, note, m[M.left]];
	}

	function smurf(list, g) {
		var mh = list.filter(counted), w = 0;
		mh.forEach(function (m) { w += m[M.win]; });
		var games = mh.length, tier = g && g[0] ? Math.floor(g[0] / 10) : 0, rate = games ? w / games : 0;
		if (!(games >= 40)) return false;
		return (games >= 60 && games < 200 && tier >= 7) || (games >= 60 && games < 400 && tier >= 9) || (games < 600 && rate >= 0.62);
	}

	// the header and the tabs' summaries, from the whole history:
	// n, w, k, d, a: normal games; l10: [wins, games, rank points] of the last 10; sm: smurf mark; hs: [hero, games] by
	// games; ss: ranked seasons [season, games, wins, best badge, last badge] newest first; f: [games, wins, souls,
	// duration] of the filtered matches
	function summary(list, g, f) {
		var mh = list.filter(counted), s = { n: 0, w: 0, k: 0, d: 0, a: 0 };
		mh.forEach(function (m) { s.n++; s.w += m[M.win]; s.k += m[M.k]; s.d += m[M.d]; s.a += m[M.a]; });
		var last = mh.slice(0, 10), lw = 0, pts = 0;
		last.forEach(function (m) { lw += m[M.win]; if (m[M.mode] === 4 && m[M.delta]) pts += m[M.delta]; });
		s.l10 = [lw, last.length, pts];
		s.sm = smurf(list, g) ? 1 : 0;
		var used = {};
		list.forEach(function (m) { used[m[M.hero]] = (used[m[M.hero]] || 0) + 1; });
		s.hs = Object.keys(used).map(function (h) { return [Number(h), used[h]]; }).sort(function (a, b) { return b[1] - a[1]; });
		var by = {};
		list.forEach(function (m) {
			if (m[M.mode] !== 4) return;
			var n = DLRPage.seasonAt(m[M.t]).n, e = by[n] || (by[n] = [n, 0, 0, 0, 0, 0]);
			e[1]++; e[2] += m[M.win];
			if (m[M.badge] > e[3]) e[3] = m[M.badge];
			if (m[M.badge] > 0 && m[M.t] > e[5]) { e[5] = m[M.t]; e[4] = m[M.badge]; }
		});
		s.ss = Object.keys(by).map(function (k) { return by[k].slice(0, 5); }).sort(function (a, b) { return b[0] - a[0]; });
		var sel = matches(list, f), t = [0, 0, 0, 0, 0, 0, 0];
		sel.forEach(function (m) { t[0]++; t[1] += m[M.win]; t[2] += m[M.nw]; t[3] += m[M.dur]; t[4] += m[M.k]; t[5] += m[M.d]; t[6] += m[M.a]; });
		s.f = t;
		return s;
	}

	// ---------- final builds ----------
	// match id -> the last 24 item ids, bought order, sold ones left out; kept a week. The list has the hero's ability
	// unlocks / upgrades in it too (one id per ability), which the mod leaves out (not shop items): a normal match ends
	// with 12 shop items at most, Street Brawl with more (15 or so). The builds that cut at 12 (abilities in) were
	// kept under "dlr_pv_builds" (profile.html's)
	var BUILDS_KEY = "dlr_pv_builds2", BUILD_MAX = 24;
	function builds(acc, ids) {
		var kept = (DLRPage.read(BUILDS_KEY, 7 * DAYMS) || {}).m || {}, out = {}, want = [];
		ids.forEach(function (id) {
			var b = kept[acc + ":" + id];
			if (b) out[id] = b; else want.push(id);
		});
		if (!want.length) return Promise.resolve(out);
		return api("/v1/matches/metadata?match_ids=" + want.slice(0, 20).join(",") + "&include_player_items=true&include_player_info=true&include_info=false" +
			"&account_ids=" + acc + "&only_filtered_players=true").then(function (list) {
			(list || []).forEach(function (m) {
				var pl = (m.players || []).filter(function (p) { return String(p.account_id) === String(acc); })[0];
				if (!pl) return;
				var own = (pl.items || []).filter(function (it) { return it.item_id && !it.sold_time_s && it.game_time_s > 0; })
					.sort(function (a, b) { return a.game_time_s - b.game_time_s; });
				var seen = {}, b = [];
				own.forEach(function (it) { if (!seen[it.item_id]) { seen[it.item_id] = 1; b.push(it.item_id); } });
				out[m.match_id] = kept[acc + ":" + m.match_id] = b.slice(-BUILD_MAX);
			});
			var keys = Object.keys(kept);
			if (keys.length > 600) keys.slice(0, keys.length - 600).forEach(function (k) { delete kept[k]; });
			DLRPage.write(BUILDS_KEY, { m: kept });
			return out;
		}, function () { return out; });
	}

	// ---------- per-hero stats ----------

	function seasonRange(which) {
		if (!which || which === "all") return null;
		var list = DLRPage.seasons(), s = which === "cur" ? DLRPage.seasonAt(Date.now() / 1000) : list.filter(function (x) { return String(x.n) === String(which); })[0];
		return s ? [s.start, s.end || 0] : null;
	}
	function rangeQuery(r) {
		return r ? "&min_unix_timestamp=" + r[0] + (r[1] ? "&max_unix_timestamp=" + r[1] : "") : "";
	}

	function cached(key, ttl, load) {
		var c = DLRPage.read(key, ttl);
		if (c) return Promise.resolve(c.d);
		return load().then(function (d) {
			DLRPage.write(key, { d: d });
			return d;
		}, function (e) {
			var old = DLRPage.read(key);
			return old ? old.d : Promise.reject(e);
		});
	}

	// rows: [hero, games, wins, k, d, a, souls a game, hero damage a game, seconds played, last played, accuracy,
	// headshot rate, total hero damage, total objective damage, total souls, last hits, denies]
	function heroStats(acc, season, mode) {
		var q = rangeQuery(seasonRange(season)) + (mode ? "&match_mode=" + mode : "");
		return cached("dlr_pv_hs_" + acc + "_" + season + "_" + mode, 10 * MIN, function () {
			return api("/v1/players/hero-stats?account_ids=" + acc + "&game_mode=normal" + q).then(function (list) {
				return (list || []).filter(function (x) { return x.matches_played > 0; }).map(function (x) {
					var mins = (x.time_played || 0) / 60, per = mins / x.matches_played;
					return [x.hero_id, x.matches_played, x.wins || 0, x.kills || 0, x.deaths || 0, x.assists || 0,
						Math.round((x.networth_per_min || 0) * per), Math.round((x.damage_per_min || 0) * per), x.time_played || 0, x.last_played || 0,
						typeof x.accuracy === "number" ? Math.round(x.accuracy * 1e4) / 1e4 : null,
						typeof x.crit_shot_rate === "number" ? Math.round(x.crit_shot_rate * 1e4) / 1e4 : null,
						x.total_player_damage || 0, x.total_boss_damage || 0, Math.round((x.networth_per_min || 0) * mins),
						Math.round((x.last_hits_per_min || 0) * mins), Math.round((x.denies_per_match || 0) * x.matches_played)];
				}).sort(function (a, b) { return b[1] - a[1]; });
			});
		});
	}

	// all-time totals (or one hero's) for the stats tab: { t: [games, wins, k, d, a, objective dmg, hero dmg, souls,
	// last hits, denies], acc: [value, percentile], hs: [value, percentile], h: [[hero, games]] }
	function stats(acc, hero) {
		return heroStats(acc, "all", "").then(function (rows) {
			var sel = hero ? rows.filter(function (x) { return x[0] === hero; }) : rows, t = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
			var shoot = [0, 0, 0];
			sel.forEach(function (x) {
				t[0] += x[1]; t[1] += x[2]; t[2] += x[3]; t[3] += x[4]; t[4] += x[5]; t[5] += x[13]; t[6] += x[12]; t[7] += x[14]; t[8] += x[15]; t[9] += x[16];
				if (typeof x[10] === "number" && typeof x[11] === "number") { shoot[0] += x[1]; shoot[1] += x[10] * x[1]; shoot[2] += x[11] * x[1]; }
			});
			var kept = !hero && typeof stored === "function" ? stored(acc) : null, p = kept && kept.p;
			var out = { t: t, h: rows.map(function (x) { return [x[0], x[1]]; }) };
			out.acc = p && p.acc ? p.acc : shoot[0] ? [Math.round(shoot[1] / shoot[0] * 1e4) / 1e4, null] : null;
			out.hs = p && p.hs ? p.hs : shoot[0] ? [Math.round(shoot[2] / shoot[0] * 1e4) / 1e4, null] : null;
			return out;
		});
	}

	// ---------- teammates / opponents ----------

	function steamProfiles(accs) {
		if (!accs.length) return Promise.resolve({});
		return api("/v1/players/steam?account_ids=" + accs.join(",")).then(function (list) {
			var by = {};
			(list || []).forEach(function (p) {
				by[p.account_id] = { n: p.personaname || "", f: (p.friends || []).map(function (x) { return x.account_id; }) };
			});
			return by;
		}, function () { return {}; });
	}

	// { r: [[account, name, games, wins, last played together, friend]], s: [party games, party wins, solo games, solo
	// wins] (side "with") , b: [name, games, wins] best duo }
	function mates(acc, side, season) {
		return cached("dlr_pv_mt_" + acc + "_" + side + "_" + season, 15 * MIN, function () { return loadMates(acc, side, season); });
	}

	function loadMates(acc, side, season) {
		var q = rangeQuery(seasonRange(season)) + "&min_matches_played=2";
		var req = side === "with" ? api("/v1/players/" + acc + "/mate-stats?same_party=true" + q) : api("/v1/players/" + acc + "/enemy-stats?" + q.slice(1));
		var load = req.then(function (list) {
			return (list || []).map(function (x) { return [side === "with" ? x.mate_id : x.enemy_id, x.matches_played, x.wins || 0, x.matches || []]; })
				.sort(function (a, b) { return b[1] - a[1]; }).slice(0, 60);
		});
		return Promise.all([load, history(acc, false).catch(function () { return { d: [] }; })]).then(function (r) {
			var list = r[0], mh = r[1].d, startOf = {};
			mh.forEach(function (m) { startOf[m[M.id]] = m[M.t]; });
			return steamProfiles([Number(acc)].concat(list.map(function (x) { return x[0]; }))).then(function (by) {
				var friends = {};
				((by[acc] || {}).f || []).forEach(function (id) { friends[id] = 1; });
				var rows = list.map(function (x) {
					var t = 0;
					x[3].forEach(function (id) { if (startOf[id] > t) t = startOf[id]; });
					return [x[0], ((by[x[0]] || {}).n || String(x[0])).slice(0, 32), x[1], x[2], t, friends[x[0]] ? 1 : 0];
				});
				var out = { r: rows };
				if (side === "with") {
					var r0 = seasonRange(season), party = {};
					list.forEach(function (x) { x[3].forEach(function (id) { party[id] = 1; }); });
					var s = [0, 0, 0, 0];
					mh.forEach(function (m) {
						if (!counted(m) || (r0 && (m[M.t] < r0[0] || (r0[1] && m[M.t] >= r0[1])))) return;
						if (party[m[M.id]]) { s[0]++; s[1] += m[M.win]; } else { s[2]++; s[3] += m[M.win]; }
					});
					out.s = s;
					var best = rows.filter(function (x) { return x[2] >= 10; }).sort(function (a, b) { return b[3] / b[2] - a[3] / a[2]; })[0];
					// [name, games, wins, account]
					out.b = best ? [best[1], best[2], best[3], best[0]] : null;
				}
				return out;
			});
		});
	}

	// ---------- rank history ----------
	// one season's rank, match by match, for the profile's native chart: { s: season shown, ss: seasons with ranked
	// matches, p: [level after each match, oldest first] (level = (tier-1)*6 + subrank-1 + share of the subrank; at
	// most RH_MAX of them, evenly picked, the last always kept), b: [first badge, last badge] }
	var RH_MAX = 120;
	function rankHistory(acc, season) {
		return Promise.all([history(acc, false), DLRPage.loadSeasons()]).then(function (r) {
			var pts = [], seen = {};
			r[0].d.forEach(function (m) {
				if (m[M.mode] !== 4 || !(m[M.badge] > 0) || !m[M.t] || seen[m[M.id]]) return;
				seen[m[M.id]] = 1;
				pts.push([m[M.t], m[M.badge], m[M.delta] || 0]);
			});
			pts.sort(function (x, y) { return x[0] - y[0]; });
			var kept = typeof stored === "function" ? stored(acc) : null, g = kept && kept.g;
			var all = DLRPage.curve(pts, g ? [g[0], g[1]] : null), ss = [];
			all.forEach(function (x) { if (ss.indexOf(x[3]) < 0) ss.push(x[3]); });
			var cur = ss.indexOf(season) >= 0 ? season : ss[ss.length - 1] || 0;
			var mine = all.filter(function (x) { return x[3] === cur; }), step = Math.max(1, mine.length / RH_MAX), out = [];
			for (var i = 0; i < mine.length; i += step) out.push(mine[Math.floor(i)]);
			if (mine.length && out[out.length - 1] !== mine[mine.length - 1]) out.push(mine[mine.length - 1]);
			// the season's ranked numbers: [games, wins, kills, deaths, assists, rank points won in all, longest win streak,
			// rank points of the best match, longest loss streak, the streak now (+wins / -losses in a row)]
			var st = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], run = 0, lost = 0;
			r[0].d.filter(function (m) { return m[M.mode] === 4 && m[M.t] && DLRPage.seasonAt(m[M.t]).n === cur; })
				.sort(function (x, y) { return x[M.t] - y[M.t]; }).forEach(function (m) {
					st[0]++;
					if (m[M.win]) { st[1]++; run++; lost = 0; if (run > st[6]) st[6] = run; } else { lost++; run = 0; if (lost > st[8]) st[8] = lost; }
					st[9] = run ? run : -lost;
					st[2] += m[M.k] || 0; st[3] += m[M.d] || 0; st[4] += m[M.a] || 0;
					st[5] += m[M.delta] || 0;
					if ((m[M.delta] || 0) > st[7]) st[7] = m[M.delta];
				});
			// the chart's points (one per ranked match of the season, oldest first, as rank-history.html draws them) with
			// their matches: [match id, hero, win, rank points, k, d, a, badge after, placement, demotion protection used,
			// souls, start]
			var byT = {};
			r[0].d.forEach(function (m) { if (m[M.mode] === 4 && m[M.t]) byT[m[M.t]] = m; });
			var hm = mine.map(function (x) {
				var m = byT[x[0]];
				return m ? [m[M.id], m[M.hero], m[M.win], m[M.delta], m[M.k], m[M.d], m[M.a], x[2], m[M.cal], m[M.prot], m[M.nw], x[0]] :
					[0, 0, -1, null, 0, 0, 0, x[2], 0, 0, 0, x[0]];
			});
			return { s: cur, ss: ss, p: out.map(function (x) { return Math.round(x[1] * 100) / 100; }), b: out.length ? [out[0][2], out[out.length - 1][2]] : [0, 0], st: st, hm: hm };
		});
	}

	return { M: M, history: history, rankHistory: rankHistory, matches: matches, streaks: streaks, row: row, summary: summary, builds: builds, heroStats: heroStats,
		stats: stats, mates: mates, counted: counted, keepHistory: keepHistory, readKept: readKept };
})();
