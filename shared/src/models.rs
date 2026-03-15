/// 与 proto TaskStatus 对应的 Rust 枚举，用于业务逻辑判断，避免魔法数字
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TaskStatus {
    Pending = 1,
    Running = 2,
    Done = 3,
    Failed = 4,
    Stopped = 5,
    Paused = 6,
}

impl TaskStatus {
    pub fn from_i32(v: i32) -> Option<Self> {
        match v {
            1 => Some(Self::Pending),
            2 => Some(Self::Running),
            3 => Some(Self::Done),
            4 => Some(Self::Failed),
            5 => Some(Self::Stopped),
            6 => Some(Self::Paused),
            _ => None,
        }
    }

    pub fn as_i32(self) -> i32 {
        self as i32
    }

    pub fn is_terminal(self) -> bool {
        matches!(self, Self::Done | Self::Failed | Self::Stopped)
    }
}
