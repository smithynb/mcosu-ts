import { ConVarRegistry } from './ConVar.ts'

export const convars = new ConVarRegistry()

const bool = (name: string, defaultValue: boolean, description = '') =>
  convars.register({ name, kind: 'bool', defaultValue, description })
const integer = (name: string, defaultValue: number, description = '') =>
  convars.register({ name, kind: 'int', defaultValue, description })
const float = (name: string, defaultValue: number, description = '') =>
  convars.register({ name, kind: 'float', defaultValue, description })

// Exact McOsu names/defaults from OsuBeatmap.cpp, OsuSlider.cpp,
// OsuBeatmapStandard.cpp, OsuGameRules.cpp, and OsuHitObject.cpp.
export const osuSnakingSliders = bool('osu_snaking_sliders', true, 'Whether slider bodies snake in during approach.')
export const osuInterpolateMusicPos = bool('osu_interpolate_music_pos', true, 'Interpolate repeated backend audio positions with real time.')
export const osuNotelockType = integer('osu_notelock_type', 2, 'Notelock: 0 none, 1 McOsu, 2 osu!stable, 3 lazer 2020.')
export const osuNoteBlocking = bool('osu_note_blocking', true, 'TypeScript compatibility switch for note blocking; McOsu uses osu_notelock_type.')
export const osuNotelockStableTolerance2B = integer('osu_notelock_stable_tolerance2b', 3, 'Stable simultaneous-object tolerance in milliseconds.')
export const osuSliderEndInsideCheckOffset = integer('osu_slider_end_inside_check_offset', 36, 'Milliseconds before slider end used for the legacy tail-inside check.')
export const osuSliderFollowCircleSizeMultiplier = float('osu_slider_followcircle_size_multiplier', 2.4, 'Retained slider follow-circle diameter/radius multiplier.')
export const osuStacking = bool('osu_stacking', true, 'Whether standard stacking calculations are enabled.')
export const osuStackingLeniencyOverride = float('osu_stacking_leniency_override', -1, 'Stack leniency override; negative uses the beatmap value.')
export const osuStackingArOverride = float('osu_stacking_ar_override', -1, 'AR used for stacking; negative uses gameplay AR.')
export const osuUniversalOffset = float('osu_universal_offset', 0, 'Universal timing offset in milliseconds, scaled by playback speed.')
export const osuLocalOffset = float('osu_local_offset', 0, 'Additional browser-local song offset in milliseconds; subtracted from gameplay time.')
export const osuModHdCircleFadeInStartPercent = float('osu_mod_hd_circle_fadein_start_percent', 1, 'HD fade-in starts this many approach times before the object.')
export const osuModHdCircleFadeInEndPercent = float('osu_mod_hd_circle_fadein_end_percent', 0.6, 'HD fade-in ends this many approach times before the object.')
export const osuModHdCircleFadeOutStartPercent = float('osu_mod_hd_circle_fadeout_start_percent', 0.6, 'HD fade-out starts this many approach times before the object.')
export const osuModHdCircleFadeOutEndPercent = float('osu_mod_hd_circle_fadeout_end_percent', 0.3, 'HD fade-out ends this many approach times before the object.')
export const osuShowApproachCircleOnFirstHiddenObject = bool('osu_show_approach_circle_on_first_hidden_object', true, 'Force the first HD object approach circle.')

export const osuApproachTimeMin = integer('osu_approachtime_min', 1800)
export const osuApproachTimeMid = integer('osu_approachtime_mid', 1200)
export const osuApproachTimeMax = integer('osu_approachtime_max', 450)
export const osuHitWindow300Min = integer('osu_hitwindow_300_min', 80)
export const osuHitWindow300Mid = integer('osu_hitwindow_300_mid', 50)
export const osuHitWindow300Max = integer('osu_hitwindow_300_max', 20)
export const osuHitWindow100Min = integer('osu_hitwindow_100_min', 140)
export const osuHitWindow100Mid = integer('osu_hitwindow_100_mid', 100)
export const osuHitWindow100Max = integer('osu_hitwindow_100_max', 60)
export const osuHitWindow50Min = integer('osu_hitwindow_50_min', 200)
export const osuHitWindow50Mid = integer('osu_hitwindow_50_mid', 150)
export const osuHitWindow50Max = integer('osu_hitwindow_50_max', 100)
export const osuHitWindowMiss = integer('osu_hitwindow_miss', 400)

// OsuBeatmap.cpp:107,113-126 and OsuScore.cpp:36. Drain type 2 is the
// corrected osu!stable algorithm McOsu enables by default.
export const osuFailTime = float('osu_fail_time', 2.25, 'Seconds used by the fail slowdown animation.')
export const osuDrainType = integer('osu_drain_type', 2, 'HP drain algorithm: 0 off, 1 VR, 2 stable, 3 lazer 2020, 4 lazer 2018.')
export const osuDrainKill = bool('osu_drain_kill', true, 'Stop gameplay after health reaches zero.')
export const osuDrainKillNotificationDuration = float('osu_drain_kill_notification_duration', 1)
export const osuDrainStablePassiveFail = bool('osu_drain_stable_passive_fail', false, 'Allow passive stable drain to trigger failure.')
export const osuDrainStableBreakBefore = bool('osu_drain_stable_break_before', false)
export const osuDrainStableBreakBeforeOld = bool('osu_drain_stable_break_before_old', true)
export const osuDrainStableBreakAfter = bool('osu_drain_stable_break_after', false)
export const osuDrainStableSpinnerNerf = float('osu_drain_stable_spinner_nerf', 0.25)
export const osuDrainStableHpBarMaximum = float('osu_drain_stable_hpbar_maximum', 200)
export const osuDrainStableHpBarRecovery = float('osu_drain_stable_hpbar_recovery', 160)
