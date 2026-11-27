//! The church's setup, behind `FirstSetup`, `ReadSetup` and `RecordVotes`.

use domain::{
    ChargeId,
    access::Invitation,
    catalog::Catalog,
    setup::{Change, Entry, NewEntry, Served, SetupError},
};

use super::{ApiError, Can, FirstSetup, ReadSetup, RecordVotes};

impl FirstSetup {
    /// The offices a first setup starts from: the bundled manual's.
    pub fn manual(&self) -> Catalog {
        Catalog::manual_2025()
    }

    /// Writes entry 1, with no vote. If another request wrote it first,
    /// nothing is written and the answer is 409.
    pub async fn start(&self, initial: &Change) -> Result<Entry, ApiError> {
        if !self.app.store.seed(initial).await? {
            return Err(ApiError::Setup(SetupError::Stale));
        }
        let first = self.app.store.history().await?.into_iter().next();
        first.ok_or(ApiError::Setup(SetupError::NoSetup))
    }
}

impl Can<ReadSetup> {
    /// The setup this request's permissions were read from, as it stands today.
    pub fn setup(&self) -> Served<'_> {
        self.setup.on(self.app.clock.now().today)
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

    /// Asks WorkOS to email the holder of `charge` an invitation to sign up,
    /// in Spanish. 404 for a charge not held, 422 for a holder with no email.
    pub async fn invite(&self, charge: ChargeId) -> Result<Invitation, ApiError> {
        let held = self.setup.charges().iter().find(|c| c.id == charge).ok_or(ApiError::NotFound)?;
        let email = held.holder.email.as_deref().ok_or(ApiError::NoEmail(charge))?;
        let sent = self.app.workos.invite(email).await.map_err(ApiError::Workos)?;
        Ok(Invitation { charge, email: email.to_owned(), expires_at: sent.expires_at })
    }
}

#[cfg(test)]
mod tests {
    use axum::http::{Method, StatusCode};
    use serde_json::json;

    use crate::testing::{DEVELOPER, TestApp};

    #[tokio::test]
    async fn the_clerk_invites_a_holder_and_workos_sends_it_in_spanish() {
        let app = TestApp::seeded().await;
        let [_, _, ana, ..] = app.with_officers().await;
        let (status, invitation) = app.call(&ana, Method::POST, "/api/setup/charges/5/invitation", None).await;
        assert_eq!(status, StatusCode::ACCEPTED);
        assert_eq!(invitation, json!({ "charge": 5, "email": "pedro@example.org", "expires_at": "2026-12-13T12:00:00.000Z" }));
        assert_eq!(app.workos.invitations(), [json!({ "email": "pedro@example.org", "locale": "es" })]);
    }

    #[tokio::test]
    async fn only_a_charge_held_with_an_email_can_be_invited() {
        let app = TestApp::seeded().await;
        let dev = app.sign_in(DEVELOPER).await;
        let (status, body) = app.call(&dev, Method::POST, "/api/setup/charges/1/invitation", None).await;
        assert_eq!((status, body["error"].as_str()), (StatusCode::UNPROCESSABLE_ENTITY, Some("charge 1 has no email to invite")));
        assert_eq!(app.call(&dev, Method::POST, "/api/setup/charges/99/invitation", None).await.0, StatusCode::NOT_FOUND);
        assert!(app.workos.invitations().is_empty(), "WorkOS was not asked");
    }

    #[tokio::test]
    async fn workos_refusing_and_workos_not_answering_get_different_answers() {
        let app = TestApp::seeded().await;
        let [_, _, ana, ..] = app.with_officers().await;
        assert_eq!(app.call(&ana, Method::POST, "/api/setup/charges/5/invitation", None).await.0, StatusCode::ACCEPTED);
        let (status, body) = app.call(&ana, Method::POST, "/api/setup/charges/5/invitation", None).await;
        assert_eq!((status, body["error"].as_str()), (StatusCode::CONFLICT, Some("An invitation has already been sent to this email.")));
        app.workos.go_down();
        let (status, body) = app.call(&ana, Method::POST, "/api/setup/charges/3/invitation", None).await;
        assert_eq!((status, body["error"].as_str()), (StatusCode::BAD_GATEWAY, Some("WorkOS did not answer; try again")));
    }
}
