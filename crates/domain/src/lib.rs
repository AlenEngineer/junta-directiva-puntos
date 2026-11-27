//! The duties the user holds and the modules each one enables.
//!
//! Types here are the single source of truth. `cargo test` exports them to
//! `web/src/generated`, so the web app never hand-copies a shape.

pub mod agenda;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct DutyId(pub u32);

/// A charge held for a term, such as first elder for one church year.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Duty {
    pub id: DutyId,
    pub title: String,
    pub term: Term,
    pub modules: Vec<Module>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Term {
    pub year: u16,
}

/// What a duty lets the user do. A new kind of work becomes a new variant
/// here, not a new branch inside an existing module.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum Module {
    Agenda,
}
