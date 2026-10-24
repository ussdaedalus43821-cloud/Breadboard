// Stage-2 electrical constants: a simplified 5 V 74HC bench. See
// docs/ARCHITECTURE.md §4c and docs/DECISIONS.md D-025…D-028.

/** Bench supply: an ideal 5 V source behind a small internal resistance. */
export const SUPPLY_VOLTS = 5;
export const SUPPLY_OHMS = 0.1;
/** Bench supply current limit. Above it the supply is shorted (SHORT). */
export const SUPPLY_LIMIT_AMPS = 1;

/** A 74HC output at 5 V: a 0 V / 5 V source behind about 50 Ω. */
export const HC_OUTPUT_OHMS = 50;
/** 74HC absolute maximum output current per pin. Above it: CONTENTION / OUTPUT_OVERLOAD. */
export const HC_OUTPUT_MAX_MILLIAMPS = 25;
/** An output stuck at X (floating input) is modelled as a mid-rail source. */
export const UNKNOWN_OUTPUT_VOLTS = 2.5;

/** 74HC input thresholds at VCC = 5 V: ≥ V_IH reads 1, ≤ V_IL reads 0, between is X. */
export const V_IH = 3.5;
export const V_IL = 1.5;

/** LED: piecewise-linear diode, off below its forward voltage. */
export const LED_OFF_SIEMENS = 1e-9;
/** An LED visibly glows above this current. */
export const LED_LIT_MILLIAMPS = 1.5;

/** Every node gets this conductance to 0 V so the system is never singular (SPICE's gmin). */
export const GMIN_SIEMENS = 1e-12;
