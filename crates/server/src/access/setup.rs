//! The church's setup, behind `ReadSetup` and `RecordVotes`.

use domain::setup::{Entry, NewEntry, Setup};

use super::{ApiError, Can, ReadSetup, RecordVotes};

impl Can<ReadSetup> {
    /// The setup this request's permissions were read from.
    pub fn setup(self) -> Setup {
        self.setup
    }

    /// Every entry, oldest first.
    pub async fn history(&self) -> Result<Vec<Entry>, ApiError> {
        Ok(self.app.store.history().await?)
    }
}

impl Can<RecordVotes> {
    /// Records a vote. The store replays the history, lets the domain check
    /// the vote and appends it in one call.
    pub async fn record(&self, new: &NewEntry) -> Result<Entry, ApiError> {
        Ok(self.app.store.record(new).await?)
    }
}
