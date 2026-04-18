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
        tools: p.tools.into_iter().map(|t| ToolCapabilityDto {
            tool_id: t.tool_id,
            available: t.available,
            source: t.source,
            path: t.path,
        }).collect(),
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

fn workflow_from_proto(wf: Option<tasks_proto::Workflow>) -> WorkflowDto {
    match wf {
        Some(w) => WorkflowDto {
            steps: w.steps.into_iter().map(|s| WorkflowStepDto {
                r#type: s.r#type,
                tool: s.tool,
            }).collect(),
        },
        None => WorkflowDto { steps: vec![] },
    }
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
        progress: p.progress,
        created_at: ts_to_rfc3339(p.created_at),
        started_at: ts_to_rfc3339(p.started_at),
        finished_at: ts_to_rfc3339(p.finished_at),
        workflow: workflow_from_proto(p.workflow),
        results: p.results.into_iter().map(scan_result_from_proto).collect(),
    }
}

pub fn scan_result_from_proto(p: tasks_proto::ScanResult) -> ScanResultDto {
    ScanResultDto {
        ip: p.ip,
        port: p.port,
        protocol: p.protocol,
        state: p.state,
        service: p.service,
        tool: p.tool,
        timestamp: p.timestamp,
    }
}

pub fn task_event_from_proto(p: tasks_proto::TaskEvent) -> Option<TaskEventDto> {
    match p.ev {
        Some(tasks_proto::task_event::Ev::Progress(p)) => Some(TaskEventDto::Progress(ProgressDto {
            percent: p.percent,
            message: p.message,
            ts: ts_to_rfc3339(p.ts),
        })),
        Some(tasks_proto::task_event::Ev::Log(l)) => Some(TaskEventDto::Log(LogChunkDto {
            subtask: l.subtask,
            text: l.text,
            is_stderr: l.is_stderr,
            offset: l.offset,
            ts: ts_to_rfc3339(l.ts),
        })),
        Some(tasks_proto::task_event::Ev::TaskSnapshot(t)) => Some(TaskEventDto::TaskSnapshot(task_from_proto(t))),
        Some(tasks_proto::task_event::Ev::Error(e)) => Some(TaskEventDto::Error(ErrorDto {
            message: e.message,
        })),
        None => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::command::tasks_proto;

    #[test]
    fn test_task_from_proto_empty_description_becomes_none() {
        let proto = tasks_proto::Task {
            id: "abc".to_string(),
            name: "test".to_string(),
            description: "".to_string(),
            targets: vec![],
            status: 1,
            exit_code: 0,
            error_message: "".to_string(),
            created_at: None,
            updated_at: None,
            started_at: None,
            finished_at: None,
            progress: 0,
            workflow: None,
            results: vec![],
        };
        let dto = task_from_proto(proto);
        assert!(dto.description.is_none());
    }

    #[test]
    fn test_task_from_proto_nonempty_description_is_some() {
        let proto = tasks_proto::Task {
            id: "xyz".to_string(),
            name: "test".to_string(),
            description: "some desc".to_string(),
            targets: vec![],
            status: 1,
            exit_code: 0,
            error_message: "".to_string(),
            created_at: None,
            updated_at: None,
            started_at: None,
            finished_at: None,
            progress: 0,
            workflow: None,
            results: vec![],
        };
        let dto = task_from_proto(proto);
        assert_eq!(dto.description, Some("some desc".to_string()));
    }

    #[test]
    fn test_ts_to_rfc3339_none_on_none_input() {
        let result = ts_to_rfc3339(None);
        assert!(result.is_none());
    }

    #[test]
    fn test_ts_to_rfc3339_valid_timestamp() {
        let ts = prost_types::Timestamp { seconds: 0, nanos: 0 };
        let result = ts_to_rfc3339(Some(ts));
        assert!(result.is_some());
        assert!(result.unwrap().contains("1970"));
    }
}
