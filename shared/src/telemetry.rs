/// 创建任务级别的 tracing span，统一 span 命名，确保跨线程追踪一致
pub fn task_span(task_id: &str) -> tracing::Span {
    tracing::info_span!("task", task_id)
}

/// 创建任务步骤级别的 tracing span
pub fn step_span(task_id: &str, step: &str) -> tracing::Span {
    tracing::info_span!("step", task_id, step)
}
