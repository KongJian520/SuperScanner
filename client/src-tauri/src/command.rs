pub mod server_info;

pub mod server_info_proto {
    tonic::include_proto!("status.v1");
}

pub mod tasks;

pub mod tasks_proto {
    tonic::include_proto!("tasks.v1");
}
