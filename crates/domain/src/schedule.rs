//! The church's places and its regular services (the horario). Both are
//! board facts: they change only by a vote, like the rest of the setup.

use std::fmt;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PlaceId(pub String);

impl From<&str> for PlaceId {
    fn from(id: &str) -> Self {
        Self(id.to_owned())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Place {
    pub id: PlaceId,
    pub name: String,
    pub kind: PlaceKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum PlaceKind {
    /// The church's own building and rooms.
    Own,
    /// Lent to the church, such as the Adventist school's classrooms.
    Borrowed,
    /// Somewhere outside, such as the corregimiento's hall.
    External,
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ServiceId(pub String);

impl From<&str> for ServiceId {
    fn from(id: &str) -> Self {
        Self(id.to_owned())
    }
}

/// A service the church holds every week, such as the Sabbath afternoon
/// Sociedad de Jóvenes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Service {
    pub id: ServiceId,
    pub name: String,
    #[serde(default)]
    #[ts(as = "Option<ServiceKind>", optional)]
    pub kind: ServiceKind,
    pub weekday: Weekday,
    pub time: ServiceTime,
    pub place: PlaceId,
}

/// What a service is, so a program's suggestions find it among the
/// several services of one weekday.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum ServiceKind {
    SabbathSchool,
    DivineService,
    YouthSociety,
    SundayNight,
    PrayerMeeting,
    #[default]
    Other,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum Weekday {
    Monday,
    Tuesday,
    Wednesday,
    Thursday,
    Friday,
    Saturday,
    Sunday,
}

/// A time of day on the 24-hour clock, `HH:MM` in JSON.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, TS)]
#[ts(export, type = "string")]
pub struct ServiceTime {
    hour: u8,
    minute: u8,
}

impl TryFrom<&str> for ServiceTime {
    type Error = String;

    fn try_from(text: &str) -> Result<Self, String> {
        let bad = || format!("{text} is not a time; write it as HH:MM, from 00:00 to 23:59");
        let (hour, minute) = text.split_once(':').ok_or_else(bad)?;
        let two_digits = |part: &str| part.parse::<u8>().ok().filter(|_| part.len() == 2 && part.bytes().all(|b| b.is_ascii_digit()));
        match (two_digits(hour), two_digits(minute)) {
            (Some(hour @ 0..=23), Some(minute @ 0..=59)) => Ok(Self { hour, minute }),
            _ => Err(bad()),
        }
    }
}

impl fmt::Display for ServiceTime {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:02}:{:02}", self.hour, self.minute)
    }
}

impl Serialize for ServiceTime {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.collect_str(self)
    }
}

impl<'de> Deserialize<'de> for ServiceTime {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        Self::try_from(String::deserialize(deserializer)?.as_str()).map_err(serde::de::Error::custom)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_service_time_is_a_24_hour_hh_mm() {
        for good in ["00:00", "09:30", "23:59"] {
            let time: ServiceTime = serde_json::from_str(&format!("\"{good}\"")).unwrap();
            assert_eq!(serde_json::to_string(&time).unwrap(), format!("\"{good}\""));
        }
        for bad in ["24:00", "19:60", "9:30", "19:3", "19.30", "1930", "+9:30", "ab:cd", ""] {
            let err = serde_json::from_str::<ServiceTime>(&format!("\"{bad}\"")).unwrap_err();
            assert!(err.to_string().contains("write it as HH:MM"), "{bad}: {err}");
        }
    }

    #[test]
    fn an_invalid_time_is_refused_when_parsing_a_service() {
        let service = |time: &str| {
            serde_json::from_str::<Service>(&format!(
                r#"{{"id":"jovenes","name":"Sociedad de Jóvenes","weekday":"saturday","time":"{time}","place":"templo"}}"#
            ))
        };
        assert_eq!(service("15:30").unwrap().time.to_string(), "15:30");
        assert!(service("25:30").is_err());
    }

    #[test]
    fn a_service_stored_without_a_kind_reads_as_other() {
        let stored = r#"{"id":"jovenes","name":"Sociedad de Jóvenes","weekday":"saturday","time":"15:30","place":"templo"}"#;
        assert_eq!(serde_json::from_str::<Service>(stored).unwrap().kind, ServiceKind::Other);
        let kinded = stored.replace(r#""weekday""#, r#""kind":"youth_society","weekday""#);
        assert_eq!(serde_json::from_str::<Service>(&kinded).unwrap().kind, ServiceKind::YouthSociety);
    }
}
