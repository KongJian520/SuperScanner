// Conversion utilities: convert Protobuf responses into DTOs serialized for the UI.
use crate::command::{server_info_proto, tasks_proto};
use crate::utils::dto::*;
use chrono::TimeZone;
use prost_types::Timestamp;

/// Convert a ServerInfoResponse (from gRPC) into a UI-friendly DTO.
pub fn server_info_from_proto(p: server_info_proto::ServerInfoResponse) -> ServerInfoDto {
    ServerInfoDto {
        hostname: p.hostname,
        os: p.os,
        uptime_seconds: Some(p.uptime_seconds),
        cpu_cores: Some(p.cpu_cores as u32),
        memory_total_bytes: Some(p.memory_total_bytes),
        memory_free_bytes: Some(p.memory_free_bytes),
        version: Some(p.version),
        load_average: p.load_average,
        disk_total_bytes: Some(p.disk_total_bytes),
        disk_free_bytes: Some(p.disk_free_bytes),
    }
}

fn ts_to_rfc3339(ts: Option<Timestamp>) -> Option<String> {
    ts.and_then(|t| {
        // seconds is i64, nanos is i32
        let secs = t.seconds;
        let nsecs = t.nanos as u32;
        chrono::Utc
            .timestamp_opt(secs, nsecs)
            .single()
            .map(|dt| dt.to_rfc3339())
    })
}

/// Convert a Task proto message into a TaskDto used by the frontend.
pub fn task_from_proto(p: tasks_proto::Task) -> TaskDto {
    TaskDto {
        id: p.id,
        name: p.name,
        description: if p.description.is_empty() {
            None
        } else {
            Some(p.description)
        },
        targets: if p.targets.is_empty() { None } else { Some(p.targets) },
        status: p.status,
        created_at: ts_to_rfc3339(p.created_at),
        started_at: ts_to_rfc3339(p.started_at),
        finished_at: ts_to_rfc3339(p.finished_at),
    }
}
