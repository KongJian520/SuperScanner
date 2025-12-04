use std::{env, path::PathBuf};

fn main() {
    let proto_root = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap())
        .join("..")
        .join("proto");
    // Use the compiler-provided OUT_DIR so `tonic::include_proto!` can find generated files
    tonic_prost_build::configure()
        .compile_protos(
            &["tasks.proto", "server_info.proto"],
            &[proto_root.to_str().unwrap()],
        )
        .unwrap_or_else(|e| panic!("Failed to compile protos {:?}", e));
}
