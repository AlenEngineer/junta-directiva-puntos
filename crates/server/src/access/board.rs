//! The board's meetings (the `agenda` module), behind `ReadBoard` and `RunBoard`.

use domain::agenda::{AgendaError, ItemId, ItemStatus, Meeting, MeetingId, NewItem, NewMeeting};

use super::{ApiError, Can, ReadBoard, RunBoard};
use crate::store::Store;

impl Can<ReadBoard> {
    /// Newest first.
    pub async fn meetings(&self) -> Result<Vec<Meeting>, ApiError> {
        Ok(self.app.store.meetings().await?)
    }

    pub async fn meeting(&self, id: MeetingId) -> Result<Meeting, ApiError> {
        load(&self.app.store, id).await
    }
}

impl Can<RunBoard> {
    /// A draft whose sections are the board agenda of this request's setup.
    pub async fn create_meeting(&self, new: &NewMeeting) -> Result<Meeting, ApiError> {
        new.validate()?;
        let id = self.app.store.create_meeting(new, &self.setup.catalog().board_agenda).await?;
        load(&self.app.store, id).await
    }

    /// Draft to called, called to held. 409 when another request moved it first.
    pub async fn advance(&self, id: MeetingId) -> Result<Meeting, ApiError> {
        let store = &self.app.store;
        let meeting = load(store, id).await?;
        let next = meeting.next_state()?;
        if !store.set_state(meeting.id, meeting.state, next).await? {
            return Err(ApiError::Conflict);
        }
        load(store, id).await
    }

    /// Only into a known section of a draft.
    pub async fn add_item(&self, id: MeetingId, item: &NewItem) -> Result<Meeting, ApiError> {
        let store = &self.app.store;
        let meeting = load(store, id).await?;
        meeting.check_new_item(item)?;
        store.add_item(meeting.id, item).await?.ok_or(ApiError::Agenda(AgendaError::AgendaClosed))?;
        load(store, id).await
    }

    pub async fn set_item_status(&self, id: MeetingId, item: ItemId, status: ItemStatus) -> Result<Meeting, ApiError> {
        if !self.app.store.set_item_status(id, item, status).await? {
            return Err(ApiError::NotFound);
        }
        load(&self.app.store, id).await
    }

    /// Only from a draft.
    pub async fn remove_item(&self, id: MeetingId, item: ItemId) -> Result<Meeting, ApiError> {
        let store = &self.app.store;
        let meeting = load(store, id).await?;
        if !meeting.items.iter().any(|i| i.id == item) {
            return Err(ApiError::NotFound);
        }
        if !store.remove_item(meeting.id, item).await? {
            return Err(ApiError::Agenda(AgendaError::AgendaClosed));
        }
        load(store, id).await
    }
}

async fn load(store: &Store, id: MeetingId) -> Result<Meeting, ApiError> {
    store.meeting(id).await?.ok_or(ApiError::NotFound)
}
