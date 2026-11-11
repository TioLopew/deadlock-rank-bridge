// The rank mod's profile page (profile.html), shown by the game over its own profile page in a visible html panel
// blended with "screen" (pure black is see-through), and over the "all matches" page (v=history).
//   profile.html#acc=<account>&p=<title prefix>&q=<request id>&lang=<game language>&v=<profile|history>
//     &nm=<name as the game shows it>&n=<the 12 tier names>&ns=<the game's own stat tiles, JSON [[label, value], ...]>
//     &cfg=<JSON of the mod's switches>
// Data: deadlock-api (match history, per-hero stats, teammates, enemies, match items) and what the bridge page keeps
// in this browser's storage for the same player (rank points, peak, leaderboard place, accuracy percentiles).
// It answers the game through its title: <prefix>{ q, k: "ready" | "error" } once, then { q, k: "act", n, a, ... }
// for what only the game can do: open a match / a profile / the "all matches" page / a url, copy the friend code.
(function () {
	"use strict";
	var P = DLRPage.params();
	var ACC = String(P.get("acc") || "");
	var LANG = String(P.get("lang") || "english").toLowerCase();
	var VIEW = P.get("v") === "history" ? "history" : "profile";
	var NATIVE_NAME = String(P.get("nm") || "");
	var TIER_NAMES = String(P.get("n") || "").split(",");
	var NATIVE_STATS = parse(P.get("ns"), null);
	// the mod's switches that are off (its settings window): ranks, streak, smurf, lb, progress, peak
	var OFF = {};
	String(P.get("off") || "").split(",").forEach(function (k) { if (k) OFF[k] = 1; });
	var API = "https://api.deadlock-api.com";

	var RU = LANG === "russian" || LANG === "ukrainian" || LANG === "bulgarian";
	var TX = {
		matches: ["Матчи", "Matches"], heroes: ["Герои", "Heroes"], mates: ["Тиммейты", "Teammates"], style: ["Стиль игры", "Playstyle"],
		stats: ["Статистика", "Stats"], showcase: ["Витрина", "Showcase"],
		n_matches: ["Матчей", "Matches"], wins: ["Побед", "Wins"], kda: ["KDA", "KDA"], acc: ["Точность", "Accuracy"], hs: ["В голову", "Headshots"],
		last10: ["За 10 игр", "Last 10"], friend_id: ["ID друга", "Friend ID"], streak: ["Серия", "Streak"], top: ["Топ", "Top"], smurf: ["Смурф?", "Smurf?"],
		season: ["Сезон", "Season"], final: ["итог", "final"], history: ["История матчей", "Match history"], all_history: ["Вся история", "All matches"],
		all_heroes: ["Все герои", "All heroes"], all_modes: ["Все режимы", "All modes"], any_result: ["Любой результат", "Any result"],
		win: ["Победа", "Victory"], loss: ["Поражение", "Defeat"], only_wins: ["Победы", "Wins"], only_losses: ["Поражения", "Defeats"],
		c_hero: ["Герой", "Hero"], c_result: ["Результат", "Result"], c_mode: ["Режим", "Mode"], c_time: ["Время", "Time"], c_kda: ["У / С / П", "K / D / A"],
		c_souls: ["Души", "Souls"], c_items: ["Предметы", "Items"], c_points: ["Очки", "Points"],
		streak_x: ["серия ×", "streak ×"], protect: ["защита", "protected"], calib: ["калибровка", "placement"],
		foot: ["{w} побед · {l} поражений за {n} матчей", "{w} wins · {l} losses in {n} matches"], pts: ["очков", "points"],
		click_match: ["клик по матчу — подробности", "click a match for details"],
		find_hero: ["Найти героя", "Find a hero"], all: ["Все", "All"], from10: ["От 10 игр", "10+ games"], wr55: ["Винрейт 55%+", "55%+ win rate"],
		sort: ["Сортировка", "Sort"], all_time: ["Всё время", "All time"], ranked: ["Рейтинг", "Ranked"], unranked: ["Обычный", "Unranked"],
		h_games: ["Матчи", "Games"], h_wins: ["Победы", "Wins"], h_souls: ["Ср. души", "Avg souls"], h_dmg: ["Ср. урон", "Avg damage"],
		h_time: ["Время в игре", "Time played"], h_last: ["Последний", "Last played"], hours: ["ч", "h"],
		heroes_foot: ["{n} героев · прокрутка колесом · клик по герою — его матчи", "{n} heroes · scroll with the wheel · click a hero for its matches"],
		with_him: ["С ним в команде", "Together"], vs_him: ["Против него", "Against"], find_player: ["Найти игрока", "Find a player"],
		in_party: ["В пати", "In a party"], solo: ["Соло", "Solo"], best_pair: ["Лучшая связка", "Best duo"],
		party_games: ["{n} игр с друзьями", "{n} games with friends"], solo_games: ["{n} игр в одиночку", "{n} games alone"],
		pair_note: ["{n} игр вместе · {w}% побед", "{n} games together · {w}% wins"], player: ["Игрок", "Player"],
		games_together: ["Игр вместе", "Games together"], games_against: ["Игр против", "Games against"], my_wins: ["Мои победы", "My wins"],
		last_game: ["Последняя игра", "Last game"], profile: ["Профиль", "Profile"], friend: ["друг", "friend"], tier: ["Ур.", "Tier"], none: ["Пока пусто", "Nothing yet"],
		axes: ["Урон,Фарм,Танк,Саппорт,Ранний,Пуш", "Damage,Farming,Tank,Support,Early,Push"],
		axes_h: ["урон по героям за минуту|души за минуту|полученный урон за минуту|лечение за минуту|души и убийства к 10-й минуте|урон по зданиям и боссам",
			"hero damage per minute|souls per minute|damage taken per minute|healing per minute|souls and kills by minute 10|damage to buildings and bosses"],
		roles: ["Дамагер,Фармер,Танк,Саппорт,Ранний темп,Пушер", "Damage dealer,Farmer,Tank,Support,Early tempo,Pusher"],
		by_axes: ["По осям", "By axis"], radar_note: ["Чем дальше от центра, тем сильнее. 50 — средний игрок.", "Further out is stronger. 50 is the average player."],
		radar_all: ["нет матчей за 30 дней — показано за всё время", "no matches in 30 days: all time shown"],
		totals: ["Всего за всё время", "All-time totals"], kills: ["Убийств", "Kills"], assists: ["Помощи", "Assists"], obj_dmg: ["Урон по целям", "Objective damage"],
		hero_dmg: ["Урон по героям", "Hero damage"], heal: ["Лечение", "Healing"], souls_total: ["Душ собрано", "Souls"], played: ["Сыграно", "Played"],
		last_hits: ["Добиваний", "Last hits"], denies: ["Отказов", "Denies"], deaths: ["Смертей", "Deaths"],
		better: ["лучше {p}% игроков", "better than {p}% of players"], worse: ["хуже {p}% игроков", "worse than {p}% of players"],
		ranked_seasons: ["Рейтинговые сезоны", "Ranked seasons"], now: ["идёт", "live"], peak: ["пик", "peak"], games_n: ["{n} игр", "{n} games"],
		wr_n: ["{p}% побед", "{p}% wins"], no_ranked: ["Нет рейтинговых матчей", "No ranked matches"], all_matches_title: ["Вся история матчей", "All matches"],
		avg_time: ["Ср. время", "Avg time"], avg_souls: ["Ср. души", "Avg souls"], loading: ["Загрузка…", "Loading…"], failed: ["Не удалось загрузить", "Could not load"],
		today: ["сегодня", "today"], yesterday: ["вчера", "yesterday"], days_ago: ["{n} дн. назад", "{n} days ago"], hours_ago: ["{n} ч назад", "{n} h ago"],
		min_ago: ["{n} мин назад", "{n} min ago"], week_ago: ["{n} нед. назад", "{n} wk ago"], month_ago: ["{n} мес. назад", "{n} mo ago"],
		steam: ["Профиль Steam", "Steam profile"], statlocker: ["Statlocker", "Statlocker"], copy: ["Скопировать", "Copy"], copied: ["Скопировано", "Copied"],
		other: ["Другие", "Other"], lobby: ["Лобби", "Lobby"], bots: ["Боты", "Bots"], brawl: ["Уличная драка", "Street Brawl"], labs: ["Лаборатория", "Hero Labs"],
		placement: ["Калибровка", "Placement"], abandoned: ["покинул", "left"], retry: ["Ещё раз", "Try again"]
	};
	function T(k, vars) {
		var e = TX[k], s = e ? e[RU ? 0 : 1] : k;
		for (var v in vars || {}) if (Object.prototype.hasOwnProperty.call(vars, v)) s = s.split("{" + v + "}").join(vars[v]);
		return s;
	}
	// the game's new tier names (its #Citadel_ranks_<t>), for when the game gave none
	var TIERS_FALLBACK = RU ? "Обскурус,Послушник,Искатель,Аколит,Страж,Мистик,Ритуалист,Эмиссар,Оракул,Фантом,Владыка,Этернус"
		: "Obscurus,Initiate,Seeker,Acolyte,Sentinel,Mystic,Ritualist,Emissary,Oracle,Phantom,Ascendant,Eternus";
	function tierName(t) {
		return TIER_NAMES[t] || TIERS_FALLBACK.split(",")[t] || "";
	}
	function badgeName(b) {
		return b > 0 ? tierName(Math.floor(b / 10)) + " " + (DLRPage.ROMAN[b % 10] || "") : "";
	}
	function badgeImg(b) {
		var t = Math.floor(b / 10), s = b % 10;
		return t >= 1 && s >= 1 ? API + "/v1/assets/ranks/" + t + "/" + s + "/image?format=webp" : "ranks/tier00.webp";
	}

	// ---------- small helpers ----------

	function parse(s, dflt) {
		try { return s ? JSON.parse(s) : dflt; } catch (e) { return dflt; }
	}
	var esc = DLRPage.esc;
	function $(id) { return document.getElementById(id); }
	function h(tag, cls, html) {
		var e = document.createElement(tag);
		if (cls) e.className = cls;
		if (html !== undefined) e.innerHTML = html;
		return e;
	}
	// whole numbers grouped the way the game's language writes them
	var LOCALE = { russian: "ru", ukrainian: "uk", bulgarian: "bg", german: "de", french: "fr", spanish: "es", latam: "es", brazilian: "pt-BR",
		portuguese: "pt", italian: "it", polish: "pl", czech: "cs", hungarian: "hu", dutch: "nl", romanian: "ro", greek: "el", turkish: "tr",
		swedish: "sv", norwegian: "nb", danish: "da", finnish: "fi", indonesian: "id", vietnamese: "vi", thai: "th", schinese: "zh-CN",
		tchinese: "zh-TW", japanese: "ja", koreana: "ko" }[LANG] || "en";
	var intFormat = null;
	try { intFormat = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 }); } catch (e) { intFormat = null; }
	function fmtInt(n) {
		n = Math.round(n || 0);
		return intFormat ? intFormat.format(n) : String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
	}
	function fmtK(n) {
		n = n || 0;
		if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
		if (n >= 1e3) return (n / 1e3).toFixed(1) + "k";
		return String(Math.round(n));
	}
	function pct(a, b) {
		return b ? Math.round(a * 100 / b) : 0;
	}
	function kda(k, d, a) {
		return ((k + a) / Math.max(1, d)).toFixed(1);
	}
	function dur(s) {
		s = Math.max(0, Math.round(s || 0));
		return Math.floor(s / 60) + ":" + ("0" + (s % 60)).slice(-2);
	}
	function ago(t) {
		var s = Date.now() / 1000 - t;
		if (s < 3600) return T("min_ago", { n: Math.max(1, Math.round(s / 60)) });
		if (s < 6 * 3600) return T("hours_ago", { n: Math.round(s / 3600) });
		var d0 = new Date(); d0.setHours(0, 0, 0, 0);
		var start = d0.getTime() / 1000;
		if (t >= start) return T("today");
		if (t >= start - 86400) return T("yesterday");
		var days = Math.ceil((start - t) / 86400);
		if (days < 14) return T("days_ago", { n: days });
		if (days < 60) return T("week_ago", { n: Math.round(days / 7) });
		return T("month_ago", { n: Math.round(days / 30) });
	}
	function wrClass(p) {
		return p >= 55 ? "good" : p <= 45 ? "bad" : "";
	}

	// rows that stand in while a list loads
	function skeleton(n) {
		var out = [];
		for (var i = 0; i < n; i++) out.push('<div class="row sk' + (i % 2 ? "" : " odd") + '"><i class="a"></i><i class="b"></i><i class="c"></i><i class="d"></i></div>');
		return out.join("");
	}

	// a load that failed: says so, with a button that tries again
	function failBox() {
		return '<div class="empty">' + esc(T("failed")) + ' · <a class="link" data-retry="1">' + esc(T("retry")) + "</a></div>";
	}

	// ---------- talking to the game ----------

	var told = false, actN = Date.now();   // grows across reloads of the page too (the game drops numbers it saw)
	function tell(kind) {
		if (told) return;
		told = true;
		DLRPage.tell(P, kind);
	}
	function act(a, extra) {
		var msg = { q: Number(P.get("q")), k: "act", n: ++actN, a: a };
		for (var k in extra || {}) if (Object.prototype.hasOwnProperty.call(extra, k)) msg[k] = extra[k];
		try { document.title = (P.get("p") || "") + JSON.stringify(msg); } catch (e) { }
	}

	// ---------- data ----------

	// deadlock-api: the page's requests share one 429 cooldown (DLRPage.get), and a request that fails for another
	// reason (network, 5xx) is tried once more a moment later
	function api(path) {
		return DLRPage.get(path, "pv").catch(function (e) {
			if (/429|cooldown|HTTP 4\d\d/.test(String(e))) return Promise.reject(e);
			return new Promise(function (r) { setTimeout(r, 1200); }).then(function () { return DLRPage.get(path, "pv"); });
		});
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
	var MIN = 60 * 1000, HOUR = 60 * MIN, DAYMS = 24 * HOUR;

	// hero id -> [name, small picture]; the same entry heroes.html keeps
	function heroNames() {
		var key = "dlr_heroes_" + LANG, kept = DLRPage.read(key, 7 * DAYMS);
		if (kept) return Promise.resolve(kept.m);
		return api("/v1/assets/heroes?language=" + encodeURIComponent(LANG) + "&only_active=true").then(function (list) {
			var m = {};
			(list || []).forEach(function (x) {
				var img = x.images || {};
				m[x.id] = [x.name || "", img.icon_image_small_webp || img.icon_image_small || ""];
			});
			DLRPage.write(key, { m: m });
			return m;
		}, function () { return {}; });
	}

	// shop item id -> [name, slot (weapon | vitality | spirit), tier, picture]
	function itemNames() {
		var key = "dlr_items_" + LANG, kept = DLRPage.read(key, 7 * DAYMS);
		if (kept) return Promise.resolve(kept.m);
		return api("/v1/assets/items/by-type/upgrade?language=" + encodeURIComponent(LANG)).then(function (list) {
			var m = {};
			(list || []).forEach(function (x) {
				if (!x || !x.id) return;
				m[x.id] = [x.name || "", x.item_slot_type || "", x.item_tier || 0, x.shop_image_webp || x.shop_image || x.image_webp || x.image || ""];
			});
			DLRPage.write(key, { m: m });
			return m;
		}, function () { return null; });
	}

	// The match history, compact, newest first:
	// [match id, hero, start, duration s, match mode, game mode, win, k, d, a, souls, last hits, denies, rank gain,
	//  badge, placement match, demotion protection used, left the match]
	// The last few players looked at keep theirs: a profile opened again shows it at once and asks for a fresh one
	// after a couple of minutes (onUpdate gets it when it differs).
	var MH_PREFIX = "dlr_pv_mh_", MH_KEEP = 16, MH_FRESH_MS = 45 * 1000, MH_MAX_MS = 30 * DAYMS;

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

	// the stored histories but this player's, oldest first
	function otherHistories(acc) {
		var out = [];
		try {
			for (var i = 0; i < localStorage.length; i++) {
				var k = localStorage.key(i);
				if (k && k.indexOf(MH_PREFIX) === 0 && k !== MH_PREFIX + acc) {
					var e = DLRPage.read(k, MH_MAX_MS * 10);
					out.push([k, e ? e.at : 0]);
				}
			}
		} catch (e) { }
		return out.sort(function (a, b) { return a[1] - b[1]; }).map(function (x) { return x[0]; });
	}

	function keepHistory(acc, list) {
		var others = otherHistories(acc);
		others.slice(0, Math.max(0, others.length - (MH_KEEP - 1))).forEach(function (k) { try { localStorage.removeItem(k); } catch (e) { } });
		var text = JSON.stringify({ at: Date.now(), d: list });
		try {
			localStorage.setItem(MH_PREFIX + acc, text);
		} catch (e) {
			// storage full: the other players' copies go first
			otherHistories(acc).forEach(function (k) { try { localStorage.removeItem(k); } catch (x) { } });
			try { localStorage.setItem(MH_PREFIX + acc, text); } catch (x) { }
		}
	}

	function historySig(list) {
		return list.length + ":" + (list[0] ? list[0][0] + ":" + list[0][13] : "");
	}

	function matchHistory(acc, onUpdate) {
		try { localStorage.removeItem("dlr_pv_mh"); } catch (e) { }   // the single copy of the first version
		var kept = DLRPage.read(MH_PREFIX + acc, MH_MAX_MS);
		var load = kept && Date.now() - kept.at < MH_FRESH_MS ? null : api("/v1/players/" + acc + "/match-history").then(function (list) {
			var out = compact(list);
			keepHistory(acc, out);
			return out;
		});
		if (!kept) return load;
		if (load) load.then(function (out) { if (historySig(out) !== historySig(kept.d)) onUpdate(out); }, function () { });
		return Promise.resolve(kept.d);
	}
	var M = { id: 0, hero: 1, t: 2, dur: 3, mode: 4, gmode: 5, win: 6, k: 7, d: 8, a: 9, nw: 10, lh: 11, dn: 12, delta: 13, badge: 14, cal: 15, prot: 16, left: 17 };

	// the matches that count as games played (the game's own count: normal games, unranked / ranked / placement)
	function counted(m) {
		return m[M.gmode] === 1 && (m[M.mode] === 1 || m[M.mode] === 4 || m[M.mode] === 8);
	}

	function steamProfiles(accs) {
		if (!accs.length) return Promise.resolve({});
		return api("/v1/players/steam?account_ids=" + accs.join(",")).then(function (list) {
			var by = {};
			(list || []).forEach(function (p) { by[p.account_id] = p; });
			return by;
		}, function () { return {}; });
	}

	// what the bridge page keeps for this player (its profile job runs while the game shows the profile)
	function bridgeData() {
		var e = DLRPage.read("dlr_player_" + ACC) || {};
		var lb = DLRPage.read("dlr_lb_" + ACC, HOUR * 6);
		return { g: e.g || null, p: e.p || null, pk: e.pk || null, lb: lb ? lb.v : null };
	}

	// final build per match of this player: match id -> [item ids] (up to 12, bought order), kept a week
	var BUILDS_KEY = "dlr_pv_builds";
	var builds = (DLRPage.read(BUILDS_KEY, 7 * DAYMS) || {}).m || {};
	var buildsTried = {};   // asked for in this page's life (a match deadlock-api has not parsed yet is not asked again)
	function saveBuilds() {
		var ids = Object.keys(builds);
		if (ids.length > 600) ids.slice(0, ids.length - 600).forEach(function (id) { delete builds[id]; });
		DLRPage.write(BUILDS_KEY, { m: builds });
	}
	function loadBuilds(ids, items, done) {
		ids = ids.filter(function (id) { return !builds[ACC + ":" + id] && !buildsTried[id]; }).slice(0, 10);
		if (!ids.length) return;
		ids.forEach(function (id) { buildsTried[id] = 1; });
		api("/v1/matches/metadata?match_ids=" + ids.join(",") + "&include_player_items=true&include_player_info=true&include_info=false&account_ids=" +
			ACC + "&only_filtered_players=true").then(function (list) {
			(list || []).forEach(function (m) {
				var pl = (m.players || []).filter(function (p) { return String(p.account_id) === ACC; })[0];
				if (!pl) return;
				var own = (pl.items || []).filter(function (it) { return items[it.item_id] && !it.sold_time_s; })
					.sort(function (a, b) { return a.game_time_s - b.game_time_s; });
				var seen = {}, out = [];
				own.forEach(function (it) { if (!seen[it.item_id]) { seen[it.item_id] = 1; out.push(it.item_id); } });
				builds[ACC + ":" + m.match_id] = out.slice(-12);
			});
			// only what came back is kept: a match missing from the answer is looked up again next time
			saveBuilds();
			done();
		}, function () { done(); });
	}

	// ---------- state ----------

	var S = {
		mh: null, heroes: {}, items: {}, steam: null, bd: bridgeData(), tab: "matches",
		mf: { hero: 0, mode: "", res: "" },          // match filters
		hf: { q: "", chip: "all", sort: "games", season: "cur", mode: "" },
		mtf: { side: "with", q: "", season: "all" },
		sf: { hero: 0 }, page: 0, showSeason: 0
	};
	S.hmf = { hero: 0, mode: "", res: "", season: 0, page: 0 };   // the all-matches page's own filters
	var tabData = {};    // lazily loaded per tab: key -> promise result

	// what the page showed (tab, filters) is kept a while: back from the all-matches page (or opened again soon after)
	// it comes up as it was
	var UI_KEY = "dlr_pv_ui_" + VIEW, UI_MS = 15 * MIN;
	(function restoreUi() {
		var ui = DLRPage.read(UI_KEY, UI_MS);
		if (!ui || ui.acc !== ACC) return;
		["tab", "mf", "hf", "mtf", "sf", "hmf", "showSeason"].forEach(function (k) { if (ui[k] !== undefined) S[k] = ui[k]; });
		S.restored = true;
	})();
	function saveUi() {
		DLRPage.write(UI_KEY, { acc: ACC, tab: S.tab, mf: S.mf, hf: S.hf, mtf: S.mtf, sf: S.sf, hmf: S.hmf, showSeason: S.showSeason });
	}

	// ---------- the header ----------

	var STEAM_ICON = '<svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M11.98 1C6.2 1 1.46 5.45 1 11.12l5.9 2.44a3.1 3.1 0 0 1 1.76-.54h.17l2.62-3.8v-.05a4.15 4.15 0 1 1 4.15 4.15h-.1l-3.74 2.67v.14a3.12 3.12 0 0 1-6.18.62L1.4 15.2A11 11 0 1 0 11.98 1zM7.9 17.7l-1.35-.56a2.33 2.33 0 1 0 1.28-3.19l1.4.58a1.72 1.72 0 1 1-1.33 3.17zm10.4-8.53a2.77 2.77 0 1 0-2.77 2.77 2.77 2.77 0 0 0 2.77-2.77zm-4.84 0a2.08 2.08 0 1 1 2.08 2.08 2.08 2.08 0 0 1-2.08-2.08z"/></svg>';
	var FLAME = '<svg viewBox="0 0 32 40" width="11" height="14"><path d="M16 1 C18 8 26 12 28 21 C30 31 24 39 16 39 C8 39 2 33 3 24 C4 18 8 15 9 10 C11 14 12 16 14 17 C13 11 14 6 16 1 Z" fill="#ff7a1a"/><path d="M16 17 C17 22 22 25 22 30 C22 35 19 38 16 38 C12 38 9 35 10 30 C10 27 12 25 13 23 C14 25 15 26 16 26 C15 23 15 20 16 17 Z" fill="#ffd25a"/></svg>';
	var COPY_ICON = '<svg viewBox="0 0 16 16" width="13" height="13"><rect x="5" y="5" width="9" height="9" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M11 3.5V3a1.5 1.5 0 0 0-1.5-1.5H3A1.5 1.5 0 0 0 1.5 3v6.5A1.5 1.5 0 0 0 3 11h.5" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>';

	function playerName() {
		return NATIVE_NAME || (S.steam && S.steam.personaname) || ACC;
	}
	function setAvatar(box) {
		var url = S.steam && (S.steam.avatarfull || S.steam.avatarmedium || S.steam.avatar);
		if (box && url && box.getAttribute("data-url") !== url) {
			box.setAttribute("data-url", url);
			box.innerHTML = '<img src="' + esc(url) + '" alt="">';
		}
	}

	function totals(list) {
		var t = { n: 0, w: 0, k: 0, d: 0, a: 0, dur: 0, nw: 0 };
		list.forEach(function (m) {
			t.n++; t.w += m[M.win]; t.k += m[M.k]; t.d += m[M.d]; t.a += m[M.a]; t.dur += m[M.dur]; t.nw += m[M.nw];
		});
		return t;
	}

	// accuracy / headshot rate [value, percentile]: the bridge page's (with the community percentile), else the per-hero
	// stats' average (no percentile)
	function accuracy() {
		var p = S.bd.p;
		if (p && (p.acc || p.hs)) return { acc: p.acc || null, hs: p.hs || null };
		return S.avgShoot || { acc: null, hs: null };
	}
	function shootAverage(rows) {
		var n = 0, a = 0, c = 0;
		rows.forEach(function (x) {
			if (typeof x.accu !== "number" || typeof x.hs !== "number") return;
			n += x.n; a += x.accu * x.n; c += x.hs * x.n;
		});
		return n ? { acc: [a / n, null], hs: [c / n, null] } : { acc: null, hs: null };
	}

	function statCell(v, label, cls) {
		return '<div class="sn"><b class="' + (cls || "") + '">' + v + "</b><span>" + esc(label) + "</span></div>";
	}

	function renderStrip() {
		var mh = (S.mh || []).filter(counted), t = totals(mh), a = accuracy(), last = mh.slice(0, 10), lw = 0;
		last.forEach(function (m) { lw += m[M.win]; });
		$("strip").innerHTML = S.mh ? statCell(fmtInt(t.n), T("n_matches")) + statCell(pct(t.w, t.n) + "%", T("wins")) +
			statCell(kda(t.k, t.d, t.a), T("kda")) +
			statCell(a.acc && typeof a.acc[0] === "number" ? (a.acc[0] * 100).toFixed(1) + "%" : "—", T("acc")) +
			statCell(a.hs && typeof a.hs[0] === "number" ? (a.hs[0] * 100).toFixed(1) + "%" : "—", T("hs")) +
			statCell(last.length ? lw + "–" + (last.length - lw) : "—", T("last10")) : statCell("…", T("n_matches"));
	}

	function smurf() {
		var mh = (S.mh || []).filter(counted), w = 0, g = S.bd.g;
		mh.forEach(function (m) { w += m[M.win]; });
		var games = mh.length, tier = g && g[0] ? Math.floor(g[0] / 10) : 0, rate = games ? w / games : 0;
		if (!(games >= 40)) return false;
		return (games >= 60 && games < 200 && tier >= 7) || (games >= 60 && games < 400 && tier >= 9) || (games < 600 && rate >= 0.62);
	}

	function renderTags() {
		var g = S.bd.g, lb = S.bd.lb, out = [];
		var streak = g && !g[4] && !OFF.streak ? g[6] || 0 : 0;
		if (streak >= 2) out.push('<span class="chip gold">' + FLAME + " " + esc(T("streak").toUpperCase()) + " ×" + streak + "</span>");
		if (lb && lb[0] > 0 && !OFF.lb) out.push('<span class="chip">' + esc(T("top").toUpperCase()) + " " + lb[0] + " · " + esc(String(lb[1] || "").toUpperCase()) +
			(g && g[5] && lb[2] && lb[2] !== g[5] && !g[4] ? " · " + esc(T("season")) + " " + lb[2] : "") + "</span>");
		if (S.mh && !OFF.smurf && smurf()) out.push('<span class="chip red">' + esc(T("smurf").toUpperCase()) + "</span>");
		$("tags").innerHTML = out.join("");
		$("tags").style.display = out.length ? "" : "none";
	}

	function renderRank() {
		var g = S.bd.g, box = $("rank");
		if (!g || !(g[0] > 0) || OFF.ranks) {
			box.style.display = "none";
			return;
		}
		box.style.display = "";
		var old = !!g[4], hasPts = typeof g[2] === "number" && g[3] > 0 && !OFF.progress;
		var sub = T("season") + " " + (g[5] || "") + (old ? " · " + T("final") : hasPts ? " · " + g[2] + " / " + g[3] : "");
		box.className = "rank card" + (old ? " old" : "");
		box.innerHTML = '<img src="' + badgeImg(g[0]) + '" alt="">' +
			'<div class="rk"><b>' + esc(badgeName(g[0])) + "</b><span>" + esc(sub) + "</span>" +
			(hasPts && !old ? '<div class="bar"><i style="width:' + (g[2] * 100 / g[3]).toFixed(1) + '%"></i></div>' : "") + "</div>";
	}

	function renderHeader() {
		setAvatar($("avatar"));
		$("name").textContent = playerName();
		renderTags();
		renderRank();
		renderStrip();
	}

	// ---------- dropdowns ----------

	// a button that opens a list; options [[value, label], ...]
	function dropdown(id, options, value, onPick, prefix) {
		var cur = options.filter(function (o) { return o[0] === value; })[0] || options[0];
		return '<div class="dd" data-dd="' + id + '"><button class="ctl">' + esc((prefix ? prefix + ": " : "") + cur[1]) + " ▾</button>" +
			'<div class="menu">' + options.map(function (o) {
				return '<div class="opt' + (o[0] === cur[0] ? " on" : "") + '" data-v="' + esc(String(o[0])) + '">' + esc(o[1]) + "</div>";
			}).join("") + "</div></div>";
	}
	var ddHandlers = {};
	function bindDropdown(root, id, onPick) {
		ddHandlers[id] = onPick;
	}
	document.addEventListener("click", function (e) {
		var opt = e.target.closest(".dd .opt"), btn = e.target.closest(".dd > button");
		var open = document.querySelectorAll(".dd.open");
		if (opt) {
			var dd = opt.closest(".dd"), fn = ddHandlers[dd.getAttribute("data-dd")];
			dd.classList.remove("open");
			if (fn) fn(opt.getAttribute("data-v"));
			return;
		}
		for (var i = 0; i < open.length; i++) if (!btn || open[i] !== btn.parentNode) open[i].classList.remove("open");
		if (btn) btn.parentNode.classList.toggle("open");
	});

	function chips(id, options, value) {
		return '<div class="chips" data-chips="' + id + '">' + options.map(function (o) {
			return '<button class="ctl' + (o[0] === value ? " on" : "") + '" data-v="' + esc(o[0]) + '">' + esc(o[1]) + "</button>";
		}).join("") + "</div>";
	}
	var chipHandlers = {};
	document.addEventListener("click", function (e) {
		var b = e.target.closest(".chips > button");
		if (!b) return;
		var fn = chipHandlers[b.parentNode.getAttribute("data-chips")];
		if (fn) fn(b.getAttribute("data-v"));
	});

	// ---------- matches (tab and the "all matches" page) ----------

	function modeName(m) {
		if (m[M.gmode] === 4) return T("brawl");
		return { 1: T("unranked"), 2: T("lobby"), 3: T("bots"), 4: T("ranked"), 7: T("labs"), 8: T("placement") }[m[M.mode]] || T("other");
	}

	// win streak of ranked wins up to and including each ranked match: match id -> streak
	var streaks = null;
	function streakAt(id) {
		if (!streaks) {
			streaks = {};
			var n = 0;
			(S.mh || []).slice().reverse().forEach(function (m) {
				if (m[M.mode] !== 4) return;
				n = m[M.win] && m[M.delta] > 0 ? n + 1 : 0;
				streaks[m[M.id]] = n;
			});
		}
		return streaks[id] || 0;
	}

	function pointsCell(m) {
		if (m[M.mode] !== 4 || m[M.delta] === null) return '<div class="pts"><b class="dim">—</b></div>';
		var d = m[M.delta], sub = "", cls = d > 0 ? "good" : d < 0 ? "bad" : "dim";
		if (m[M.cal]) sub = '<span>' + esc(T("calib")) + "</span>";
		else if (d < 0 && m[M.prot]) sub = '<span>' + esc(T("protect")) + "</span>";
		else if (d > 0 && streakAt(m[M.id]) >= 3) sub = '<span class="gold">' + esc(T("streak_x")) + streakAt(m[M.id]) + "</span>";
		return '<div class="pts"><b class="' + cls + '">' + (d > 0 ? "+" : d < 0 ? "−" : "") + Math.abs(d) + "</b>" + sub + "</div>";
	}

	function itemsCell(m) {
		var b = builds[ACC + ":" + m[M.id]], out = [];
		for (var i = 0; i < 12; i++) {
			var it = b && b[i] ? S.items[b[i]] : null;
			out.push(it ? '<img class="it ' + esc(it[1]) + '" loading="lazy" decoding="async" src="' + esc(it[3]) + '" data-tip="' + esc(it[0]) + '" data-tier="' + (it[2] || "") + '" alt="">' : '<i class="it' + (b ? "" : " wait") + '"></i>');
		}
		return '<div class="items">' + out.join("") + "</div>";
	}

	var MATCH_COLS = [["c_hero", "hero"], ["c_result", "res"], ["c_mode", "mode"], ["c_time", "time"], ["c_kda", "kda"], ["c_souls", "souls"], ["c_items", "itemsc"], ["c_points", "ptsc"]];

	function matchHead() {
		return '<div class="thead mt">' + MATCH_COLS.map(function (c) { return '<span class="' + c[1] + '">' + esc(T(c[0])) + "</span>"; }).join("") + "</div>";
	}

	function matchRow(m, i) {
		var hero = S.heroes[m[M.hero]] || ["#" + m[M.hero], ""], tot = Math.max(1, m[M.k] + m[M.d] + m[M.a]);
		var drawn = S.itemsReady && builds[ACC + ":" + m[M.id]] ? ' data-b="1"' : "";
		return '<div class="row mt ' + (m[M.win] ? "w" : "l") + (i % 2 ? "" : " odd") + '" data-match="' + m[M.id] + '"' + drawn + ">" +
			'<div class="hero">' + (hero[1] ? '<img loading="lazy" decoding="async" src="' + esc(hero[1]) + '" alt="">' : "<i></i>") + "<b>" + esc(hero[0]) + "</b></div>" +
			'<div class="res"><b class="' + (m[M.win] ? "good" : "bad") + '">' + esc(T(m[M.win] ? "win" : "loss")) + "</b><span>" +
			esc(ago(m[M.t])) + (m[M.left] ? " · " + esc(T("abandoned")) : "") + "</span></div>" +
			'<div class="mode">' + esc(modeName(m)) + "</div>" +
			'<div class="time">' + dur(m[M.dur]) + "</div>" +
			'<div class="kda"><b>' + m[M.k] + " <em>/</em> " + m[M.d] + " <em>/</em> " + m[M.a] + '</b><div class="kbar"><i style="width:' +
			(m[M.k] * 100 / tot).toFixed(1) + '%" class="k"></i><i style="width:' + (m[M.d] * 100 / tot).toFixed(1) + '%" class="d"></i><i style="width:' +
			(m[M.a] * 100 / tot).toFixed(1) + '%" class="a"></i></div></div>' +
			'<div class="souls">' + fmtK(m[M.nw]) + "</div>" +
			'<div class="itemsc">' + itemsCell(m) + "</div>" +
			'<div class="ptsc">' + pointsCell(m) + "</div></div>";
	}

	function filteredMatches(f) {
		return (S.mh || []).filter(function (m) {
			if (f.hero && m[M.hero] !== f.hero) return false;
			if (f.mode === "ranked" && m[M.mode] !== 4) return false;
			if (f.mode === "unranked" && !(m[M.mode] === 1 && m[M.gmode] === 1)) return false;
			if (f.mode === "other" && (m[M.mode] === 4 || (m[M.mode] === 1 && m[M.gmode] === 1))) return false;
			if (f.res === "w" && !m[M.win]) return false;
			if (f.res === "l" && m[M.win]) return false;
			if (f.season) {
				var s = DLRPage.seasonAt(m[M.t]);
				if (s.n !== f.season) return false;
			}
			return true;
		});
	}

	function heroOptions() {
		var used = {};
		(S.mh || []).forEach(function (m) { used[m[M.hero]] = (used[m[M.hero]] || 0) + 1; });
		return [[0, T("all_heroes")]].concat(Object.keys(used).map(Number).sort(function (a, b) {
			return String((S.heroes[a] || [""])[0]).localeCompare(String((S.heroes[b] || [""])[0]));
		}).map(function (id) { return [id, (S.heroes[id] || ["#" + id])[0]]; }));
	}
	var MODE_OPTS = function () { return [["", T("all_modes")], ["ranked", T("ranked")], ["unranked", T("unranked")], ["other", T("other")]]; };
	var RES_OPTS = function () { return [["", T("any_result")], ["w", T("only_wins")], ["l", T("only_losses")]]; };

	function bindMatchFilters(f, rerender) {
		bindDropdown(null, "mhero", function (v) { f.hero = Number(v) || 0; f.page = 0; rerender(); });
		bindDropdown(null, "mmode", function (v) { f.mode = v; f.page = 0; rerender(); });
		bindDropdown(null, "mres", function (v) { f.res = v; f.page = 0; rerender(); });
		bindDropdown(null, "mseason", function (v) { f.season = Number(v) || 0; f.page = 0; rerender(); });
	}

	// rows on screen get their items (10 matches a request)
	// item cells of the rows: drawn again where the build is known by now (data-b marks a drawn one)
	function redrawItems(scroller) {
		var rows = scroller.querySelectorAll(".row[data-match]");
		for (var j = 0; j < rows.length; j++) {
			var row = rows[j], id = row.getAttribute("data-match");
			if (row.getAttribute("data-b") || !builds[ACC + ":" + id]) continue;
			var cell = row.querySelector(".itemsc"), m = S.byId[id];
			if (cell && m) {
				cell.innerHTML = itemsCell(m);
				row.setAttribute("data-b", "1");
			}
		}
	}

	// rows in view (and a little around) get their builds, 10 matches a request, one request at a time
	function fillItems(scroller) {
		if (!scroller || !S.itemsReady || !scroller.isConnected) return;
		redrawItems(scroller);
		if (scroller.dlrBusy) return;
		var rows = scroller.querySelectorAll(".row[data-match]"), top = scroller.scrollTop, bottom = top + scroller.clientHeight + 200, want = [];
		for (var i = 0; i < rows.length; i++) {
			var r = rows[i];
			if (r.offsetTop + r.offsetHeight < top - 100 || r.offsetTop > bottom) continue;
			var id = r.getAttribute("data-match");
			if (!builds[ACC + ":" + id] && !buildsTried[id]) want.push(id);
		}
		if (!want.length) return;
		scroller.dlrBusy = true;
		loadBuilds(want, S.items, function () {
			scroller.dlrBusy = false;
			fillItems(scroller);
		});
	}
	function watchScroll(scroller) {
		var timer = 0;
		scroller.addEventListener("scroll", function () {
			clearTimeout(timer);
			timer = setTimeout(function () { fillItems(scroller); }, 150);
		});
		fillItems(scroller);
	}

	var CHUNK = 30, MAX_ROWS = 300;

	function tabMatches(body) {
		var f = S.mf, list = filteredMatches(f), last = (S.mh || []).filter(counted).slice(0, 10), w = 0, sum = 0;
		last.forEach(function (m) { w += m[M.win]; if (m[M.mode] === 4 && m[M.delta]) sum += m[M.delta]; });
		body.innerHTML = '<div class="bar-top"><span class="lab">' + esc(T("history")) + '</span><span class="grow"></span>' +
			dropdown("mhero", heroOptions(), f.hero) + dropdown("mmode", MODE_OPTS(), f.mode) + dropdown("mres", RES_OPTS(), f.res) + "</div>" +
			'<div class="table">' + matchHead() + '<div class="scroll" id="mscroll">' +
			(list.length ? list.slice(0, CHUNK).map(matchRow).join("") : '<div class="empty">' + esc(T("none")) + "</div>") + "</div></div>" +
			'<div class="foot"><span>' + esc(T("foot", { w: w, l: last.length - w, n: last.length })) + (sum ? " · " + (sum > 0 ? "+" : "−") + Math.abs(sum) + " " + esc(T("pts")) : "") +
			" · " + esc(T("click_match")) + '</span><span class="grow"></span><a class="link" data-act="all">' + esc(T("all_history")) + " →</a></div>";
		bindMatchFilters(f, function () { showTab("matches"); });
		var sc = $("mscroll"), shown = Math.min(CHUNK, list.length);
		// more rows as the list nears its end (the full history lives on the all-matches page)
		sc.addEventListener("scroll", function () {
			if (shown >= Math.min(list.length, MAX_ROWS) || sc.scrollTop + sc.clientHeight < sc.scrollHeight - 300) return;
			sc.insertAdjacentHTML("beforeend", list.slice(shown, Math.min(shown + CHUNK, MAX_ROWS)).map(function (m, i) { return matchRow(m, shown + i); }).join(""));
			shown = Math.min(shown + CHUNK, MAX_ROWS);
		});
		watchScroll(sc);
	}

	// ---------- heroes ----------

	function seasonRange(which) {
		var list = DLRPage.seasons(), cur = DLRPage.seasonAt(Date.now() / 1000);
		if (which === "all") return null;
		var s = which === "cur" ? cur : list.filter(function (x) { return String(x.n) === String(which); })[0];
		return s ? [s.start, s.end || 0] : null;
	}
	function seasonOptions(withAll) {
		var list = DLRPage.seasons().slice().reverse(), now = Date.now() / 1000;
		var out = list.filter(function (s) { return s.start <= now; }).map(function (s) { return [String(s.n), T("season") + " " + s.n]; });
		var cur = DLRPage.seasonAt(now);
		out = out.map(function (o) { return o[0] === String(cur.n) ? ["cur", o[1]] : o; });
		if (withAll) out.push(["all", T("all_time")]);
		return out;
	}
	function rangeQuery(r) {
		return r ? "&min_unix_timestamp=" + r[0] + (r[1] ? "&max_unix_timestamp=" + r[1] : "") : "";
	}

	function heroStats(season, mode) {
		var key = "hs|" + season + "|" + mode;
		if (!tabData[key]) {
			var q = rangeQuery(seasonRange(season)) + (mode ? "&match_mode=" + mode : "");
			tabData[key] = api("/v1/players/hero-stats?account_ids=" + ACC + "&game_mode=normal" + q).then(function (list) {
				return (list || []).filter(function (x) { return x.matches_played > 0; }).map(function (x) {
					var mins = (x.time_played || 0) / 60, per = mins / x.matches_played;
					return { id: x.hero_id, n: x.matches_played, w: x.wins || 0, k: x.kills || 0, d: x.deaths || 0, a: x.assists || 0,
						souls: (x.networth_per_min || 0) * per, dmg: (x.damage_per_min || 0) * per, time: x.time_played || 0, last: x.last_played || 0,
						dmgT: x.total_player_damage || 0, obj: x.total_boss_damage || 0, nwT: (x.networth_per_min || 0) * mins,
						lh: Math.round((x.last_hits_per_min || 0) * mins), dn: Math.round((x.denies_per_match || 0) * x.matches_played),
						accu: x.accuracy, hs: x.crit_shot_rate };
				});
			});
		}
		tabData[key].catch(function () { delete tabData[key]; });
		return tabData[key];
	}

	function tabHeroes(body) {
		var f = S.hf;
		body.innerHTML = '<div class="bar-top"><div class="search"><span>⌕</span><input id="hq" placeholder="' + esc(T("find_hero")) + '" value="' + esc(f.q) + '"></div>' +
			chips("hchip", [["all", T("all")], ["10", T("from10")], ["55", T("wr55")]], f.chip) + '<span class="grow"></span>' +
			dropdown("hsort", [["games", T("h_games")], ["wr", T("h_wins")], ["kda", "KDA"], ["souls", T("h_souls")], ["dmg", T("h_dmg")], ["time", T("h_time")], ["last", T("h_last")]], f.sort, null, T("sort")) +
			dropdown("hseason", seasonOptions(true), f.season) +
			dropdown("hmode", [["", T("all_modes")], ["ranked", T("ranked")], ["unranked", T("unranked")]], f.mode) + "</div>" +
			'<div class="table"><div class="thead ht"><span class="hero">' + esc(T("c_hero")) + '</span><span class="num">' + esc(T("h_games")) + '</span><span class="wr">' +
			esc(T("h_wins")) + '</span><span class="num">KDA</span><span class="num">' + esc(T("h_souls")) + '</span><span class="num">' + esc(T("h_dmg")) +
			'</span><span class="num w">' + esc(T("h_time")) + '</span><span class="num w">' + esc(T("h_last")) + '</span></div><div class="scroll" id="hscroll">' + skeleton(10) +
			'</div></div><div class="foot"><span id="hfoot"></span></div>';
		var q = $("hq");
		q.addEventListener("input", function () { f.q = q.value; draw(); });
		chipHandlers.hchip = function (v) { f.chip = v; showTab("heroes"); };
		bindDropdown(null, "hsort", function (v) { f.sort = v; showTab("heroes"); });
		bindDropdown(null, "hseason", function (v) { f.season = v; showTab("heroes"); });
		bindDropdown(null, "hmode", function (v) { f.mode = v; showTab("heroes"); });
		var rows = null;
		function draw() {
			if (!rows) return;
			var needle = f.q.trim().toLowerCase();
			var list = rows.filter(function (x) {
				if (f.chip === "10" && x.n < 10) return false;
				if (f.chip === "55" && pct(x.w, x.n) < 55) return false;
				var name = (S.heroes[x.id] || [""])[0].toLowerCase();
				return !needle || name.indexOf(needle) >= 0;
			});
			var key = { games: "n", wr: "wrv", kda: "kdav", souls: "souls", dmg: "dmg", time: "time", last: "last" }[f.sort] || "n";
			list.forEach(function (x) { x.wrv = x.w / x.n; x.kdav = (x.k + x.a) / Math.max(1, x.d); });
			list.sort(function (a, b) { return b[key] - a[key] || b.n - a.n; });
			$("hscroll").innerHTML = list.length ? list.map(function (x, i) {
				var hero = S.heroes[x.id] || ["#" + x.id, ""], p = pct(x.w, x.n);
				return '<div class="row ht' + (i % 2 ? "" : " odd") + '" data-hero="' + x.id + '"><div class="hero">' + (hero[1] ? '<img loading="lazy" decoding="async" src="' + esc(hero[1]) + '" alt="">' : "<i></i>") +
					"<b>" + esc(hero[0]) + '</b></div><div class="num"><b>' + x.n + '</b></div><div class="wr"><b class="' + wrClass(p) + '">' + p + '%</b><div class="wbar"><i class="' +
					wrClass(p) + '" style="width:' + p + '%"></i></div></div><div class="num">' + kda(x.k, x.d, x.a) + '</div><div class="num souls">' + fmtK(x.souls) +
					'</div><div class="num">' + fmtK(x.dmg) + '</div><div class="num w">' + Math.round(x.time / 3600) + " " + esc(T("hours")) + '</div><div class="num w dim">' +
					(x.last ? esc(ago(x.last)) : "—") + "</div></div>";
			}).join("") : '<div class="empty">' + esc(T("none")) + "</div>";
			$("hfoot").textContent = T("heroes_foot", { n: list.length });
		}
		heroStats(f.season, f.mode).then(function (r) { rows = r; if (S.tab === "heroes") draw(); }, function () {
			if (S.tab === "heroes") $("hscroll").innerHTML = failBox();
		});
	}

	// ---------- teammates ----------

	function mates(side, season) {
		var key = "mt|" + side + "|" + season;
		if (!tabData[key]) {
			var q = rangeQuery(seasonRange(season)) + "&min_matches_played=2";
			var load = side === "with" ? api("/v1/players/" + ACC + "/mate-stats?same_party=true" + q).then(function (list) {
				return (list || []).map(function (x) { return { id: x.mate_id, n: x.matches_played, w: x.wins || 0, m: x.matches || [] }; });
			}) : api("/v1/players/" + ACC + "/enemy-stats?" + q.slice(1)).then(function (list) {
				return (list || []).map(function (x) { return { id: x.enemy_id, n: x.matches_played, w: x.wins || 0, m: x.matches || [] }; });
			});
			tabData[key] = load.then(function (list) {
				list.sort(function (a, b) { return b.n - a.n; });
				list = list.slice(0, 100);
				return steamProfiles(list.slice(0, 100).map(function (x) { return x.id; })).then(function (by) {
					list.forEach(function (x) {
						var p = by[x.id] || {};
						x.name = p.personaname || String(x.id);
						x.av = p.avatarmedium || p.avatar || "";
					});
					return list;
				});
			});
		}
		tabData[key].catch(function () { delete tabData[key]; });
		return tabData[key];
	}

	function tabMates(body) {
		var f = S.mtf;
		body.innerHTML = '<div class="bar-top">' + chips("mside", [["with", T("with_him")], ["vs", T("vs_him")]], f.side) +
			'<div class="search"><span>⌕</span><input id="mq" placeholder="' + esc(T("find_player")) + '" value="' + esc(f.q) + '"></div><span class="grow"></span>' +
			dropdown("mtseason", seasonOptions(true), f.season) + "</div>" +
			'<div class="cards3" id="msum"></div>' +
			'<div class="table"><div class="thead pt"><span class="hero">' + esc(T("player")) + '</span><span class="num">' + esc(T(f.side === "with" ? "games_together" : "games_against")) +
			'</span><span class="wr">' + esc(T(f.side === "with" ? "h_wins" : "my_wins")) + '</span><span class="num w">' + esc(T("last_game")) + '</span><span class="go"></span></div>' +
			'<div class="scroll" id="mtscroll">' + skeleton(10) + "</div></div>";
		chipHandlers.mside = function (v) { f.side = v; showTab("mates"); };
		bindDropdown(null, "mtseason", function (v) { f.season = v; showTab("mates"); });
		var q = $("mq"), rows = null;
		q.addEventListener("input", function () { f.q = q.value; draw(); });
		var friends = {};
		((S.steam && S.steam.friends) || []).forEach(function (x) { friends[x.account_id] = 1; });
		var startOf = {};
		(S.mh || []).forEach(function (m) { startOf[m[M.id]] = m[M.t]; });
		function lastWith(x) {
			var t = 0;
			x.m.forEach(function (id) { if (startOf[id] > t) t = startOf[id]; });
			return t;
		}
		function summary() {
			var r = seasonRange(f.season), mh = (S.mh || []).filter(function (m) { return counted(m) && (!r || (m[M.t] >= r[0] && (!r[1] || m[M.t] < r[1]))); });
			var party = {};
			if (f.side === "with") rows.forEach(function (x) { x.m.forEach(function (id) { party[id] = 1; }); });
			var pn = 0, pw = 0, sn = 0, sw = 0;
			mh.forEach(function (m) { if (party[m[M.id]]) { pn++; pw += m[M.win]; } else { sn++; sw += m[M.win]; } });
			var best = rows.filter(function (x) { return x.n >= 10; }).sort(function (a, b) { return b.w / b.n - a.w / a.n; })[0];
			if (f.side !== "with") { $("msum").style.display = "none"; return; }
			$("msum").style.display = "";
			$("msum").innerHTML = '<div class="card sum"><span class="lab">' + esc(T("in_party")) + '</span><b class="' + wrClass(pct(pw, pn)) + '">' + (pn ? pct(pw, pn) + "%" : "—") +
				"</b><span>" + esc(T("party_games", { n: pn })) + '</span></div><div class="card sum"><span class="lab">' + esc(T("solo")) + '</span><b class="' + wrClass(pct(sw, sn)) + '">' +
				(sn ? pct(sw, sn) + "%" : "—") + "</b><span>" + esc(T("solo_games", { n: sn })) + '</span></div><div class="card sum"><span class="lab">' + esc(T("best_pair")) + "</span><b>" +
				(best ? esc(best.name) : "—") + "</b><span>" + (best ? esc(T("pair_note", { n: best.n, w: pct(best.w, best.n) })) : "") + "</span></div>";
		}
		function draw() {
			if (!rows) return;
			var needle = f.q.trim().toLowerCase();
			var list = rows.filter(function (x) { return !needle || x.name.toLowerCase().indexOf(needle) >= 0; });
			$("mtscroll").innerHTML = list.length ? list.map(function (x, i) {
				var p = pct(x.w, x.n), t = lastWith(x);
				return '<div class="row pt' + (i % 2 ? "" : " odd") + '" data-prof="' + x.id + '"><div class="hero"><span class="av">' + (x.av ? '<img loading="lazy" decoding="async" src="' + esc(x.av) + '" alt="">' : "") +
					"</span><b>" + esc(x.name) + "</b>" + (friends[x.id] ? '<span class="tag">' + esc(T("friend").toUpperCase()) + "</span>" : "") + '</div><div class="num"><b>' + x.n +
					'</b></div><div class="wr"><b class="' + wrClass(p) + '">' + p + '%</b><div class="wbar"><i class="' + wrClass(p) + '" style="width:' + p + '%"></i></div></div>' +
					'<div class="num w dim">' + (t ? esc(ago(t)) : "—") + '</div><div class="go"><a class="link">' + esc(T("profile")) + " →</a></div></div>";
			}).join("") : '<div class="empty">' + esc(T("none")) + "</div>";
		}
		mates(f.side, f.season).then(function (r) {
			rows = r;
			if (S.tab !== "mates") return;
			summary();
			draw();
		}, function () {
			if (S.tab === "mates") $("mtscroll").innerHTML = failBox();
		});
	}

	// ---------- playstyle ----------

	var AXIS_COLORS = ["#F05A5A", "#7AF0C8", "#E8A23A", "#A6E22E", "#3D7BF2", "#B47FEB"];

	function radar(sc, labels) {
		var W = 400, H = 330, cx = W / 2, cy = H / 2 + 4, R = 112, r2 = DLRPage.r2, s = [];
		function pt(i, share) {
			var a = -Math.PI / 2 + i * Math.PI / 3;
			return [cx + Math.cos(a) * R * share, cy + Math.sin(a) * R * share];
		}
		s.push('<svg viewBox="0 0 ' + W + " " + H + '" width="' + W + '" height="' + H + '">');
		[0.5, 1].forEach(function (ring) {
			s.push('<polygon points="' + [0, 1, 2, 3, 4, 5].map(function (i) { return pt(i, ring).map(r2).join(","); }).join(" ") +
				'" fill="none" stroke="#FFEFD7" stroke-opacity="' + (ring === 1 ? 0.22 : 0.12) + '"/>');
		});
		s.push('<polygon points="' + sc.map(function (v, i) { return pt(i, (v || 0) / 100).map(r2).join(","); }).join(" ") +
			'" fill="#B47FEB" fill-opacity="0.32" stroke="#B47FEB" stroke-width="2.5" stroke-linejoin="round"/>');
		sc.forEach(function (v, i) {
			var p = pt(i, 1.2), anchor = Math.abs(p[0] - cx) < 4 ? "middle" : p[0] < cx ? "end" : "start";
			s.push('<text x="' + r2(p[0]) + '" y="' + r2(p[1] + 6) + '" text-anchor="' + anchor + '" font-size="17" font-weight="700" fill="#FFEFD7">' +
				esc(labels[i] || "") + " " + (v === null ? "—" : Math.round(v)) + "</text>");
		});
		s.push("</svg>");
		return s.join("");
	}

	function tabStyle(body) {
		body.innerHTML = '<div class="empty">' + esc(T("loading")) + "</div>";
		if (!tabData.style) {
			tabData.style = DLRStyle.load(ACC);
			tabData.style.catch(function () { delete tabData.style; });
		}
		tabData.style.then(function (r) {
			if (S.tab !== "style") return;
			var labels = T("axes").split(","), helps = T("axes_h").split("|"), roles = T("roles").split(",");
			var top = r.sc.map(function (v, i) { return [v, i]; }).filter(function (x) { return x[0] !== null && x[0] >= 60; })
				.sort(function (a, b) { return b[0] - a[0]; }).slice(0, 2);
			body.innerHTML = '<div class="style"><div class="radar"><div class="roles">' + top.map(function (x) {
				return '<span class="chip" style="color:' + AXIS_COLORS[x[1]] + ";background:" + AXIS_COLORS[x[1]] + '22">' + esc(roles[x[1]].toUpperCase()) + "</span>";
			}).join("") + "</div>" + radar(r.sc, labels) + '<p class="note">' + esc(T("radar_note")) + (r.all ? "<br>" + esc(T("radar_all")) : "") + "</p></div>" +
				'<div class="axes"><span class="lab">' + esc(T("by_axes")) + "</span>" + r.sc.map(function (v, i) {
					return '<div class="axis"><div class="an"><b>' + esc(labels[i]) + "</b><span>" + esc(helps[i] || "") + '</span></div><div class="ab"><i style="width:' +
						(v === null ? 0 : v) + "%;background:" + AXIS_COLORS[i] + '"></i><em></em></div><b class="av">' + (v === null ? "—" : Math.round(v)) + "</b></div>";
				}).join("") + "</div></div>";
		}, function () {
			if (S.tab === "style") body.innerHTML = failBox();
		});
	}

	// ---------- stats ----------

	var STAT_COLORS = ["#F05A5A", "#B47FEB", "#E8A23A", "#3D7BF2", "#A6E22E", "#7AF0C8"];
	var STAT_ICONS = [
		'<circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="2.5" fill="currentColor"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5" stroke="currentColor" stroke-width="2"/>',
		'<path d="M4 13l4-4 4 3 4-5 4 4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/><path d="M4 18h16" stroke="currentColor" stroke-width="2"/>',
		'<path d="M5 20V9l7-5 7 5v11z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M10 20v-6h4v6" fill="none" stroke="currentColor" stroke-width="2"/>',
		'<path d="M4 20L20 4M14 4h6v6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 14l6 6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
		'<path d="M12 4v16M4 12h16" stroke="currentColor" stroke-width="4" stroke-linecap="round"/>',
		'<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 7v10M9 9.5c0-1.5 6-1.5 6 0s-6 2-6 4 6 1.5 6 0" fill="none" stroke="currentColor" stroke-width="1.8"/>'
	];

	function tile(v, label, i) {
		return '<div class="card tile"><svg viewBox="0 0 24 24" width="34" height="34" style="color:' + STAT_COLORS[i % 6] + '">' + STAT_ICONS[i % 6] + "</svg><b style=\"color:" +
			STAT_COLORS[i % 6] + '">' + esc(v) + "</b><span>" + esc(label) + "</span></div>";
	}

	function pctBar(label, m) {
		var v = m && typeof m[0] === "number" ? (m[0] * 100).toFixed(1) + "%" : "—", p = m && typeof m[1] === "number" ? m[1] : null;
		var note = p === null ? "" : p >= 50 ? T("better", { p: Math.round(p) }) : T("worse", { p: Math.round(100 - p) });
		return '<div class="card pbar"><div class="ph"><span class="lab">' + esc(label) + "</span><b>" + v + '</b></div><div class="grad">' +
			(p === null ? "" : '<i style="left:' + p.toFixed(1) + '%"></i>') + '</div><span class="' + (p === null ? "" : p >= 50 ? "good" : "warn") + '">' + esc(note) + "</span></div>";
	}

	function tabStats(body) {
		var f = S.sf;
		body.innerHTML = '<div class="bar-top"><span class="lab">' + esc(T("totals")) + '</span><span class="grow"></span><span id="sdd"></span></div><div id="sbody"><div class="empty">' +
			esc(T("loading")) + "</div></div>";
		heroStats("all", "").then(function (rows) {
			if (S.tab !== "stats") return;
			var opts = [[0, T("all_heroes")]].concat(rows.slice().sort(function (a, b) { return b.n - a.n; }).map(function (x) { return [x.id, (S.heroes[x.id] || ["#" + x.id])[0]]; }));
			$("sdd").innerHTML = dropdown("shero", opts, f.hero);
			bindDropdown(null, "shero", function (v) { f.hero = Number(v) || 0; showTab("stats"); });
			var sel = f.hero ? rows.filter(function (x) { return x.id === f.hero; }) : rows;
			var t = { n: 0, w: 0, k: 0, d: 0, a: 0, obj: 0, dmg: 0, nw: 0, lh: 0, dn: 0 };
			sel.forEach(function (x) { t.n += x.n; t.w += x.w; t.k += x.k; t.d += x.d; t.a += x.a; t.obj += x.obj; t.dmg += x.dmgT; t.nw += x.nwT; t.lh += x.lh; t.dn += x.dn; });
			var tiles, rowsHtml;
			// the game's own tiles (all heroes; healing and commends are only there) where it has them
			var nat = !f.hero && NATIVE_STATS && NATIVE_STATS.t && NATIVE_STATS.t.length ? NATIVE_STATS : null;
			if (nat) {
				tiles = nat.t.slice(0, 6).map(function (x, i) { return tile(x[1], x[0], i); }).join("");
				rowsHtml = (nat.l || []).map(function (x) { return statCell(esc(x[1]), x[0]); }).join("");
			} else {
				tiles = tile(fmtInt(t.k), T("kills"), 0) + tile(fmtInt(t.a), T("assists"), 1) + tile(fmtK(t.obj), T("obj_dmg"), 2) + tile(fmtK(t.dmg), T("hero_dmg"), 3) +
					tile(fmtInt(t.d), T("deaths"), 4) + tile(fmtK(t.nw), T("souls_total"), 5);
				rowsHtml = statCell(fmtInt(t.n), T("played")) + statCell(fmtInt(t.w), T("wins")) + statCell(fmtInt(t.lh), T("last_hits")) + statCell(fmtInt(t.dn), T("denies")) +
					statCell(kda(t.k, t.d, t.a), "KDA");
			}
			var a = accuracy(), one = f.hero && sel[0];
			$("sbody").innerHTML = '<div class="tiles">' + tiles + '</div><div class="card rowstats">' + rowsHtml + '</div><div class="pbars">' +
				pctBar(T("acc"), one ? [sel[0].accu, null] : a.acc) + pctBar(T("hs"), one ? [sel[0].hs, null] : a.hs) + "</div>";
		}, function () {
			if (S.tab === "stats") $("sbody").innerHTML = failBox();
		});
	}

	// ---------- showcase ----------

	function seasonSummary() {
		var by = {};
		(S.mh || []).forEach(function (m) {
			if (m[M.mode] !== 4) return;
			var s = DLRPage.seasonAt(m[M.t]), e = by[s.n] || (by[s.n] = { n: s.n, games: 0, wins: 0, peak: 0, last: 0, lastT: 0 });
			e.games++; e.wins += m[M.win];
			if (m[M.badge] > e.peak) e.peak = m[M.badge];
			if (m[M.badge] > 0 && m[M.t] > e.lastT) { e.lastT = m[M.t]; e.last = m[M.badge]; }
		});
		return Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) { return b.n - a.n; });
	}

	function tabShowcase(body) {
		var list = seasonSummary(), cur = DLRPage.seasonAt(Date.now() / 1000).n, g = S.bd.g;
		if (!list.length) {
			body.innerHTML = '<span class="lab">' + esc(T("ranked_seasons")) + '</span><div class="empty">' + esc(T("no_ranked")) + "</div>";
			return;
		}
		var show = S.showSeason || list[0].n;
		var main = list.filter(function (s) { return s.n === show; })[0] || list[0];
		var badge = main.n === cur && g && g[0] > 0 && !g[4] ? g[0] : main.last;
		var chart = "rank-history.html?r=" + Date.now() + "#acc=" + ACC + "&n=" + encodeURIComponent(TIER_NAMES.join(",")) + "&s=" + main.n + "&fin=" + encodeURIComponent(T("final"));
		var others = list.filter(function (s) { return s !== main; });
		body.innerHTML = '<span class="lab">' + esc(T("ranked_seasons")) + '</span><div class="seasons"><div class="card season main">' +
			'<div class="sh"><img src="' + badgeImg(badge) + '" alt=""><div class="st"><span class="lab">' + esc(T("season")) + " " + main.n +
			(main.n === cur ? ' <em class="live">' + esc(T("now")) + "</em>" : "") + "</span><b>" + esc(badgeName(badge)) + "</b><span>" +
			esc(T("peak")) + " " + esc(badgeName(main.peak)) + " · " + esc(T("games_n", { n: main.games })) + " · " + esc(T("wr_n", { p: pct(main.wins, main.games) })) +
			"</span></div>" + chips("sseason", list.slice().reverse().map(function (s) { return [String(s.n), T("season") + " " + s.n]; }), String(main.n)) +
			'</div><iframe class="chart" src="' + chart + '"></iframe></div>' +
			others.map(function (s) {
				return '<div class="card season old"><img src="' + badgeImg(s.last) + '" alt=""><span class="lab">' + esc(T("season")) + " " + s.n + " · " + esc(T("final")) +
					"</span><b>" + esc(badgeName(s.last)) + "</b><span>" + esc(T("peak")) + " " + esc(badgeName(s.peak)) + " · " + esc(T("games_n", { n: s.games })) + " · " +
					esc(T("wr_n", { p: pct(s.wins, s.games) })) + "</span></div>";
			}).join("") + "</div>";
		chipHandlers.sseason = function (v) { S.showSeason = Number(v); showTab("showcase"); };
	}

	// ---------- tabs ----------

	var TABS = [["matches", tabMatches], ["heroes", tabHeroes], ["mates", tabMates], ["style", tabStyle], ["stats", tabStats], ["showcase", tabShowcase]];

	function showTab(name) {
		S.tab = name;
		var nav = $("tabs");
		nav.innerHTML = TABS.map(function (t) { return '<a class="tab' + (t[0] === name ? " on" : "") + '" data-tab="' + t[0] + '">' + esc(T(t[0])) + "</a>"; }).join("");
		var body = $("body");
		body.className = "body t-" + name;
		TABS.filter(function (t) { return t[0] === name; })[0][1](body);
		saveUi();
	}

	// ---------- the "all matches" page ----------

	var PAGE = 13, ROW_H = 44;   // rows a page: as many as fit, measured once the page is laid out
	function renderHistory() {
		var f = S.hmf, list = filteredMatches(f), t = totals(list), pages = Math.max(1, Math.ceil(list.length / PAGE));
		f.page = Math.min(f.page || 0, pages - 1);
		var p = f.page, rows = list.slice(p * PAGE, p * PAGE + PAGE);
		var nums = [];
		for (var i = 0; i < pages; i++) if (i < 3 || i === pages - 1 || Math.abs(i - p) <= 1) nums.push(i);
		var pager = '<button class="ctl pg" data-page="' + Math.max(0, p - 1) + '">‹</button>';
		nums.forEach(function (n, j) {
			if (j && n - nums[j - 1] > 1) pager += '<span class="pg dots">…</span>';
			pager += '<button class="ctl pg' + (n === p ? " on" : "") + '" data-page="' + n + '">' + (n + 1) + "</button>";
		});
		pager += '<button class="ctl pg" data-page="' + Math.min(pages - 1, p + 1) + '">›</button>';
		$("hbody").innerHTML = '<div class="bar-top">' + dropdown("mhero", heroOptions(), f.hero) + dropdown("mmode", MODE_OPTS(), f.mode) + dropdown("mres", RES_OPTS(), f.res) +
			dropdown("mseason", [[0, T("all_time")]].concat(seasonOptions(false).map(function (o) { return [o[0] === "cur" ? DLRPage.seasonAt(Date.now() / 1000).n : Number(o[0]), o[1]]; })), f.season || 0) +
			'<span class="grow"></span><span class="dim cnt">' + fmtInt(list.length) + " " + esc(T("n_matches").toLowerCase()) + "</span>" + pager + "</div>" +
			'<div class="table">' + matchHead() + '<div class="scroll" id="mscroll">' + (rows.length ? rows.map(matchRow).join("") : '<div class="empty">' + esc(T("none")) + "</div>") + "</div></div>";
		$("hstrip").innerHTML = statCell(fmtInt(t.n), T("n_matches")) + statCell(pct(t.w, t.n) + "%", T("wins")) + statCell(kda(t.k, t.d, t.a), "KDA") +
			statCell(t.n ? dur(t.dur / t.n) : "—", T("avg_time")) + statCell(t.n ? fmtK(t.nw / t.n) : "—", T("avg_souls"), "souls");
		bindMatchFilters(f, renderHistory);
		var sc = $("mscroll"), fits = Math.max(6, Math.floor(sc.clientHeight / ROW_H));
		if (fits !== PAGE && rows.length) {
			// the first item of the page stays on it
			var firstIndex = p * PAGE;
			PAGE = fits;
			f.page = Math.floor(firstIndex / PAGE);
			return renderHistory();
		}
		saveUi();
		watchScroll(sc);
	}

	// ---------- clicks ----------

	document.addEventListener("click", function (e) {
		var el = e.target.closest("[data-tab],[data-match],[data-prof],[data-act],[data-hero],[data-page],[data-retry]");
		if (!el) return;
		// a failed list: the tab's own data is asked again; the match history (everything hangs on it) by a reload
		if (el.hasAttribute("data-retry")) {
			if (VIEW === "history" || !S.mh || !S.mh.length) return location.reload();
			return showTab(S.tab);
		}
		if (el.hasAttribute("data-tab")) return showTab(el.getAttribute("data-tab"));
		if (el.hasAttribute("data-page")) { S.hmf.page = Number(el.getAttribute("data-page")); return renderHistory(); }
		if (el.hasAttribute("data-match")) return act("match", { id: Number(el.getAttribute("data-match")) });
		if (el.hasAttribute("data-prof")) return act("profile", { acc: Number(el.getAttribute("data-prof")) });
		if (el.hasAttribute("data-hero")) { S.mf.hero = Number(el.getAttribute("data-hero")); return showTab("matches"); }
		var a = el.getAttribute("data-act");
		if (a === "all") act("all", { acc: Number(ACC) });
		else if (a === "steam") act("steam", { acc: Number(ACC) });
		else if (a === "statlocker") act("url", { u: "https://statlocker.gg/profile/" + ACC + "/matches" });
		else if (a === "copy") {
			act("copy", { t: ACC });
			el.classList.add("done");
			setTimeout(function () { el.classList.remove("done"); }, 1200);
		}
	});

	// item names over the item pictures
	var tip = $("tip");
	document.addEventListener("mouseover", function (e) {
		var it = e.target && e.target.closest ? e.target.closest("img.it[data-tip]") : null;
		if (!it) { tip.style.display = "none"; return; }
		var tier = it.getAttribute("data-tier");
		tip.className = (it.className.match(/weapon|vitality|spirit/) || [""])[0];
		tip.innerHTML = esc(it.getAttribute("data-tip")) + (tier ? "<span>" + esc(T("tier")) + " " + esc(tier) + "</span>" : "");
		tip.style.display = "block";
		var r = it.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
		tip.style.left = Math.max(4, Math.min(innerWidth - w - 4, r.left + r.width / 2 - w / 2)) + "px";
		tip.style.top = (r.top - h - 6 < 4 ? r.bottom + 6 : r.top - h - 6) + "px";
	});
	document.addEventListener("scroll", function () { tip.style.display = "none"; }, true);

	// Esc in the page (while it has the keyboard): the game's "back", unless the game saw it itself
	document.addEventListener("keydown", function (e) {
		if (e.key !== "Escape") return;
		var open = document.querySelectorAll(".dd.open");
		if (open.length) {
			for (var i = 0; i < open.length; i++) open[i].classList.remove("open");
			return;
		}
		act("back");
	});

	// ---------- start ----------

	function fit() {
		var designH = VIEW === "history" ? 880 : 900;
		document.documentElement.style.zoom = String(Math.max(0.5, (window.innerHeight || designH) / designH));
	}

	function start() {
		fit();
		window.addEventListener("resize", fit);
		if (!/^\d+$/.test(ACC)) return tell("error");
		document.body.className = "v-" + VIEW;
		if (VIEW === "profile") {
			$("fid").textContent = ACC;
			$("btn-steam").innerHTML = STEAM_ICON;
			$("btn-steam").title = T("steam");
			$("btn-sl").title = T("statlocker");
			$("fidlab").textContent = T("friend_id");
			$("fidcopy").innerHTML = COPY_ICON;
		} else {
			$("htitle").textContent = T("all_matches_title");
		}
		renderHeaderSafe();
		var wait = '<div class="table"><div class="scroll">' + skeleton(12) + "</div></div>";
		if (VIEW === "profile") {
			$("tabs").innerHTML = TABS.map(function (t, i) { return '<a class="tab' + (i ? "" : " on") + '">' + esc(T(t[0])) + "</a>"; }).join("");
			$("body").innerHTML = wait;
		} else {
			$("hbody").innerHTML = wait;
		}
		// the page is up: the game shows it now (and keeps its own page only when this one never loads)
		tell("ready");
		DLRPage.loadSeasons();
		var steam = steamProfiles([ACC]).then(function (by) { S.steam = by[ACC] || null; renderHeaderSafe(); });
		var names = heroNames().then(function (m) { S.heroes = m; });
		// item pictures are only needed once rows are up: the first ever load (a ~2 MB list) does not hold the page
		itemNames().then(function (m) {
			if (!m || !Object.keys(m).length) return;
			S.items = m;
			S.itemsReady = true;
			var sc = $("mscroll");
			if (sc) fillItems(sc);
		});
		heroStats("all", "").then(function (rows) { S.avgShoot = shootAverage(rows); renderHeaderSafe(); }, function () { });
		function setHistory(mh) {
			S.mh = mh;
			S.byId = {};
			streaks = null;
			mh.forEach(function (m) { S.byId[m[M.id]] = m; });
		}
		var history = matchHistory(ACC, function (fresh) {
			// a newer history than the stored one shown first
			setHistory(fresh);
			renderHeaderSafe();
			if (VIEW === "history") renderHistory();
			else if (S.tab === "matches" || S.tab === "showcase" || S.tab === "mates") showTab(S.tab);
		}).then(setHistory);
		// the bridge page's numbers for this player arrive while it works (its profile job runs alongside): taken on
		// its storage writes, with a slow look for browsers that do not pass those on between pages
		var shownBd = JSON.stringify(S.bd);
		function freshBridge() {
			var bd = bridgeData(), text = JSON.stringify(bd);
			if (text === shownBd) return;
			shownBd = text;
			var before = S.bd;
			S.bd = bd;
			renderHeaderSafe();
			// the tabs that show these numbers, only when theirs changed
			if ((S.tab === "stats" && JSON.stringify(before.p) !== JSON.stringify(bd.p)) ||
				(S.tab === "showcase" && JSON.stringify(before.g) !== JSON.stringify(bd.g))) showTab(S.tab);
		}
		window.addEventListener("storage", function (e) {
			if (!e.key || e.key === "dlr_player_" + ACC || e.key === "dlr_lb_" + ACC) freshBridge();
		});
		var polls = 0, poll = setInterval(function () {
			freshBridge();
			if (++polls > 20) clearInterval(poll);
		}, 3000);
		Promise.all([names, history.catch(function () { S.mh = S.mh || []; S.failed = true; })]).then(function () {
			renderHeaderSafe();
			var want = P.get("tab") || (S.restored ? S.tab : "");
			if (VIEW === "profile") showTab(TABS.some(function (t) { return t[0] === want; }) ? want : "matches");
			else renderHistory();
			if (S.failed && !S.mh.length) {
				var b = VIEW === "profile" ? $("body") : $("hbody");
				if (S.tab === "matches" || VIEW === "history") b.querySelector(".scroll").innerHTML = failBox();
			}
			tell("ready");
		});
		steam.catch(function () { });
	}

	function renderHeaderSafe() {
		try {
			if (VIEW === "profile") renderHeader();
			else {
				setAvatar($("havatar"));
				$("hname").textContent = playerName();
			}
		} catch (e) { }
	}

	start();
})();
