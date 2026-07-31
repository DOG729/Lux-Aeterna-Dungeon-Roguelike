'use strict';

// Shared mutable state — all modules read/write state.G and state.busy
export const state = {
  G:    null,
  busy: false,
  UI:   {}
};
