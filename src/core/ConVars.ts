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
