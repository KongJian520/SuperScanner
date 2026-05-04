use std::{env, path::PathBuf};

fn main() {
    let protoc = protoc_bin_vendored::protoc_bin_path().expect("protoc-bin-vendored not found");
    // SAFETY: single-threaded build script
    unsafe {
        env::set_var("PROTOC", protoc);
    }

    let proto_root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../proto");
    println!("cargo:rerun-if-changed={}", proto_root.display());

    tonic_prost_build::configure()
        .compile_protos(
            &["tasks.proto", "status.proto"],
            &[proto_root.to_str().unwrap()],
        )
        .unwrap_or_else(|e| panic!("Failed to compile protos: {:?}", e));
}
