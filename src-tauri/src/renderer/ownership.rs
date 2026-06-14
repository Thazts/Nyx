#![allow(non_snake_case)]

use std::collections::HashMap;
use std::time::{Duration, Instant};

use serde_json::{json, Value};

pub const HYBRID_OWNERSHIP: bool = true;

pub const BLEND_DURATION: Duration = Duration::from_millis(200);

pub const MISSING_TICKS_LIMIT: u32 = 8;

#[derive(Debug, Clone, Copy)]
pub struct OwnedTransform {
    pub position: [f32; 3],
    pub rotation: [f32; 3],
    pub size: [f32; 3],
    pub has_rotation: bool,
    pub has_size: bool,
}

impl Default for OwnedTransform {
    fn default() -> Self {
        Self {
            position: [0.0; 3],
            rotation: [0.0; 3],
            size: [1.0; 3],
            has_rotation: false,
            has_size: false,
        }
    }
}

#[derive(Debug, Clone)]
pub enum OwnershipPhase {
    Held,
    Kept,
    BlendingBack {
        started: Instant,
        from: OwnedTransform,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PartSignature {
    pub name: String,
    pub ordinal: usize,
}

#[derive(Debug, Clone)]
pub struct PartOwnership {
    pub phase: OwnershipPhase,
    pub transform: OwnedTransform,
    pub signature: PartSignature,
    pub user_ownable: bool,
    pub missing_ticks: u32,
}

impl PartOwnership {
    pub fn held(transform: OwnedTransform, signature: PartSignature, user_ownable: bool) -> Self {
        Self {
            phase: OwnershipPhase::Held,
            transform,
            signature,
            user_ownable,
            missing_ticks: 0,
        }
    }

    pub fn release(&mut self, now: Instant) {
        if let OwnershipPhase::Held = self.phase {
            self.phase = if self.user_ownable {
                OwnershipPhase::Kept
            } else {
                OwnershipPhase::BlendingBack {
                    started: now,
                    from: self.transform,
                }
            };
        }
    }

    pub fn resume(&mut self, now: Instant) {
        match self.phase {
            OwnershipPhase::Kept | OwnershipPhase::Held => {
                self.phase = OwnershipPhase::BlendingBack {
                    started: now,
                    from: self.transform,
                };
            }
            OwnershipPhase::BlendingBack { .. } => {}
        }
    }
}

pub fn KeptIds(ownership: &HashMap<String, PartOwnership>) -> Vec<String> {
    let mut Ids: Vec<String> = ownership
        .iter()
        .filter(|(_, Owned)| matches!(Owned.phase, OwnershipPhase::Kept))
        .map(|(Id, _)| Id.clone())
        .collect();
    Ids.sort();
    Ids
}

fn IsEditable(Command: &Value) -> bool {
    matches!(
        Command.get("Cmd").and_then(Value::as_str),
        Some("AddPart") | Some("AddMesh")
    )
}

fn ReadScalar(Command: &Value, Key: &str, Field: &str, Default: f32) -> f32 {
    Command
        .get(Key)
        .and_then(|Object| Object.get(Field))
        .and_then(Value::as_f64)
        .map(|Value| Value as f32)
        .unwrap_or(Default)
}

pub fn ReadTransform(Command: &Value) -> OwnedTransform {
    OwnedTransform {
        position: [
            ReadScalar(Command, "Position", "X", 0.0),
            ReadScalar(Command, "Position", "Y", 0.0),
            ReadScalar(Command, "Position", "Z", 0.0),
        ],
        rotation: [
            ReadScalar(Command, "CFrame", "RX", 0.0),
            ReadScalar(Command, "CFrame", "RY", 0.0),
            ReadScalar(Command, "CFrame", "RZ", 0.0),
        ],
        size: [
            ReadScalar(Command, "Size", "X", 1.0),
            ReadScalar(Command, "Size", "Y", 1.0),
            ReadScalar(Command, "Size", "Z", 1.0),
        ],
        has_rotation: Command.get("CFrame").is_some(),
        has_size: Command.get("Size").is_some(),
    }
}

pub fn SignatureOf(Command: &Value, Ordinal: usize) -> PartSignature {
    PartSignature {
        name: Command
            .get("Name")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        ordinal: Ordinal,
    }
}

fn WriteTransform(Command: &mut Value, Transform: &OwnedTransform) {
    let Some(Object) = Command.as_object_mut() else {
        return;
    };
    Object.insert(
        "Position".to_string(),
        json!({
            "X": Transform.position[0],
            "Y": Transform.position[1],
            "Z": Transform.position[2],
        }),
    );
    let mut CFrame = Object
        .get("CFrame")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    CFrame.insert("X".to_string(), json!(Transform.position[0]));
    CFrame.insert("Y".to_string(), json!(Transform.position[1]));
    CFrame.insert("Z".to_string(), json!(Transform.position[2]));
    if Transform.has_rotation {
        CFrame.insert("RX".to_string(), json!(Transform.rotation[0]));
        CFrame.insert("RY".to_string(), json!(Transform.rotation[1]));
        CFrame.insert("RZ".to_string(), json!(Transform.rotation[2]));
    }
    Object.insert("CFrame".to_string(), Value::Object(CFrame));
    if Transform.has_size {
        Object.insert(
            "Size".to_string(),
            json!({
                "X": Transform.size[0],
                "Y": Transform.size[1],
                "Z": Transform.size[2],
            }),
        );
    }
}

fn FreezeForPhysics(Command: &mut Value) {
    let Some(Object) = Command.as_object_mut() else {
        return;
    };
    Object.insert("Anchored".to_string(), json!(true));
    let Zero = json!({ "X": 0.0, "Y": 0.0, "Z": 0.0 });
    Object.insert("AssemblyLinearVelocity".to_string(), Zero.clone());
    Object.insert("Velocity".to_string(), Zero.clone());
    Object.insert("AssemblyAngularVelocity".to_string(), Zero.clone());
    Object.insert("RotVelocity".to_string(), Zero);
}

fn Smoothstep(T: f32) -> f32 {
    let T = T.clamp(0.0, 1.0);
    T * T * (3.0 - 2.0 * T)
}

fn LerpTransform(From: &OwnedTransform, To: &OwnedTransform, Alpha: f32) -> OwnedTransform {
    let Lerp3 = |A: [f32; 3], B: [f32; 3]| {
        [
            A[0] + (B[0] - A[0]) * Alpha,
            A[1] + (B[1] - A[1]) * Alpha,
            A[2] + (B[2] - A[2]) * Alpha,
        ]
    };
    OwnedTransform {
        position: Lerp3(From.position, To.position),
        rotation: Lerp3(From.rotation, To.rotation),
        size: Lerp3(From.size, To.size),
        has_rotation: From.has_rotation || To.has_rotation,
        has_size: From.has_size || To.has_size,
    }
}

enum MergeAction {
    Hold(OwnedTransform),
    Blend(Instant, OwnedTransform),
}

pub fn ApplyOwnershipMerge(
    commands: &mut [Value],
    ownership: &mut HashMap<String, PartOwnership>,
    now: Instant,
) {
    if !HYBRID_OWNERSHIP || ownership.is_empty() {
        return;
    }

    for Owned in ownership.values_mut() {
        Owned.missing_ticks = Owned.missing_ticks.saturating_add(1);
    }

    let mut Finished: Vec<String> = Vec::new();
    let mut Ordinal = 0usize;

    for Command in commands.iter_mut() {
        if !IsEditable(Command) {
            continue;
        }
        let ThisOrdinal = Ordinal;
        Ordinal += 1;

        let Id = match Command.get("Id").and_then(Value::as_str) {
            Some(Value) => Value.to_string(),
            None => continue,
        };
        let Some(Owned) = ownership.get_mut(&Id) else {
            continue;
        };

        let Name = Command
            .get("Name")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        if Owned.signature.name != Name || Owned.signature.ordinal != ThisOrdinal {
            continue;
        }

        let Action = match &Owned.phase {
            OwnershipPhase::Held | OwnershipPhase::Kept => MergeAction::Hold(Owned.transform),
            OwnershipPhase::BlendingBack { started, from } => MergeAction::Blend(*started, *from),
        };

        let Presented = match Action {
            MergeAction::Hold(Transform) => Transform,
            MergeAction::Blend(Started, From) => {
                let Elapsed = now.saturating_duration_since(Started);
                if Elapsed >= BLEND_DURATION {
                    Owned.missing_ticks = 0;
                    Finished.push(Id.clone());
                    continue;
                }
                let Alpha = Smoothstep(Elapsed.as_secs_f32() / BLEND_DURATION.as_secs_f32());
                let Target = ReadTransform(Command);
                LerpTransform(&From, &Target, Alpha)
            }
        };

        Owned.transform = Presented;
        Owned.missing_ticks = 0;
        WriteTransform(Command, &Presented);
        FreezeForPhysics(Command);
    }

    ownership
        .retain(|Id, Owned| Owned.missing_ticks <= MISSING_TICKS_LIMIT && !Finished.contains(Id));
}

#[cfg(test)]
mod tests {
    use super::*;

    fn PartCommand(Id: &str, Name: &str, Position: [f32; 3], Color: [f32; 3]) -> Value {
        json!({
            "Cmd": "AddPart",
            "Id": Id,
            "Name": Name,
            "Position": { "X": Position[0], "Y": Position[1], "Z": Position[2] },
            "CFrame": { "X": Position[0], "Y": Position[1], "Z": Position[2], "RX": 0.0, "RY": 0.0, "RZ": 0.0 },
            "Size": { "X": 2.0, "Y": 2.0, "Z": 2.0 },
            "Color": { "R": Color[0], "G": Color[1], "B": Color[2] },
            "Anchored": false,
        })
    }

    fn PositionOf(Command: &Value) -> [f32; 3] {
        [
            ReadScalar(Command, "Position", "X", -999.0),
            ReadScalar(Command, "Position", "Y", -999.0),
            ReadScalar(Command, "Position", "Z", -999.0),
        ]
    }

    fn HeldEntry(Position: [f32; 3], Name: &str, Ordinal: usize) -> PartOwnership {
        PartOwnership::held(
            OwnedTransform {
                position: Position,
                rotation: [0.0; 3],
                size: [2.0; 3],
                has_rotation: false,
                has_size: false,
            },
            PartSignature {
                name: Name.to_string(),
                ordinal: Ordinal,
            },
            false,
        )
    }

    #[test]
    fn HeldPartOverridesTransformButKeepsCosmetics() {
        let mut Commands = vec![PartCommand(
            "Part_1",
            "Ball",
            [0.0, 10.0, 0.0],
            [1.0, 0.0, 0.0],
        )];
        let mut Ownership = HashMap::new();
        Ownership.insert("Part_1".to_string(), HeldEntry([5.0, 5.0, 5.0], "Ball", 0));

        ApplyOwnershipMerge(&mut Commands, &mut Ownership, Instant::now());

        assert_eq!(
            PositionOf(&Commands[0]),
            [5.0, 5.0, 5.0],
            "user transform wins"
        );
        assert_eq!(
            ReadScalar(&Commands[0], "Color", "R", -1.0),
            1.0,
            "script colour must pass through"
        );
        assert_eq!(
            Commands[0].get("Anchored").and_then(Value::as_bool),
            Some(true),
            "held part must be anchored for the solver"
        );
        assert_eq!(Ownership["Part_1"].missing_ticks, 0, "recognised this tick");
    }

    #[test]
    fn CosmeticChangesStillFlowWhileHeld() {
        let mut Ownership = HashMap::new();
        Ownership.insert("Part_1".to_string(), HeldEntry([5.0, 5.0, 5.0], "Ball", 0));

        let mut Commands = vec![PartCommand(
            "Part_1",
            "Ball",
            [0.0, 10.0, 0.0],
            [0.2, 0.4, 0.6],
        )];
        ApplyOwnershipMerge(&mut Commands, &mut Ownership, Instant::now());

        assert_eq!(PositionOf(&Commands[0]), [5.0, 5.0, 5.0]);
        assert_eq!(ReadScalar(&Commands[0], "Color", "G", -1.0), 0.4);
    }

    #[test]
    fn BlendEasesFromReleaseTowardScript() {
        let Now = Instant::now();
        let Started = Now.checked_sub(BLEND_DURATION / 2).unwrap();
        let mut Ownership = HashMap::new();
        Ownership.insert(
            "Part_1".to_string(),
            PartOwnership {
                phase: OwnershipPhase::BlendingBack {
                    started: Started,
                    from: OwnedTransform {
                        position: [10.0, 0.0, 0.0],
                        ..Default::default()
                    },
                },
                transform: OwnedTransform {
                    position: [10.0, 0.0, 0.0],
                    ..Default::default()
                },
                signature: PartSignature {
                    name: "Ball".to_string(),
                    ordinal: 0,
                },
                user_ownable: false,
                missing_ticks: 0,
            },
        );

        let mut Commands = vec![PartCommand(
            "Part_1",
            "Ball",
            [0.0, 0.0, 0.0],
            [1.0, 1.0, 1.0],
        )];
        ApplyOwnershipMerge(&mut Commands, &mut Ownership, Now);

        let X = PositionOf(&Commands[0])[0];
        assert!((X - 5.0).abs() < 0.01, "expected ~5.0 mid-blend, got {X}");
        assert!(Ownership.contains_key("Part_1"), "still blending");
    }

    #[test]
    fn BlendCompletesAndHandsBackToScript() {
        let Now = Instant::now();
        let Started = Now.checked_sub(BLEND_DURATION * 2).unwrap();
        let mut Ownership = HashMap::new();
        Ownership.insert(
            "Part_1".to_string(),
            PartOwnership {
                phase: OwnershipPhase::BlendingBack {
                    started: Started,
                    from: OwnedTransform {
                        position: [10.0, 0.0, 0.0],
                        ..Default::default()
                    },
                },
                transform: OwnedTransform {
                    position: [10.0, 0.0, 0.0],
                    ..Default::default()
                },
                signature: PartSignature {
                    name: "Ball".to_string(),
                    ordinal: 0,
                },
                user_ownable: false,
                missing_ticks: 0,
            },
        );

        let mut Commands = vec![PartCommand(
            "Part_1",
            "Ball",
            [0.0, 0.0, 0.0],
            [1.0, 1.0, 1.0],
        )];
        ApplyOwnershipMerge(&mut Commands, &mut Ownership, Now);

        assert_eq!(PositionOf(&Commands[0]), [0.0, 0.0, 0.0], "script reclaims");
        assert!(!Ownership.contains_key("Part_1"), "ownership dropped");
    }

    #[test]
    fn UserOwnableReleaseKeepsPlacementIndefinitely() {
        let mut Entry = HeldEntry([7.0, 1.0, 0.0], "Ball", 0);
        Entry.user_ownable = true;
        Entry.release(Instant::now());
        assert!(
            matches!(Entry.phase, OwnershipPhase::Kept),
            "user-ownable release should enter Kept, not BlendingBack"
        );

        let mut Ownership = HashMap::new();
        Ownership.insert("Part_1".to_string(), Entry);

        for Tick in 0..120 {
            let ScriptX = (Tick as f32) * 0.1;
            let mut Commands = vec![PartCommand(
                "Part_1",
                "Ball",
                [ScriptX, 10.0, 0.0],
                [1.0, 0.0, 0.0],
            )];
            ApplyOwnershipMerge(&mut Commands, &mut Ownership, Instant::now());
            assert_eq!(
                PositionOf(&Commands[0]),
                [7.0, 1.0, 0.0],
                "kept part must stay at the user's placement on tick {Tick}"
            );
        }
        assert!(
            Ownership.contains_key("Part_1"),
            "kept ownership must not expire while the part is present"
        );
    }

    #[test]
    fn NonOwnableReleaseBlendsBack() {
        let mut Entry = HeldEntry([7.0, 1.0, 0.0], "Ball", 0);
        Entry.user_ownable = false;
        Entry.release(Instant::now());
        assert!(
            matches!(Entry.phase, OwnershipPhase::BlendingBack { .. }),
            "a non-ownable release should blend back, not keep"
        );
    }

    #[test]
    fn RenamedPartIsHandedBackToScript() {
        let mut Ownership = HashMap::new();
        Ownership.insert("Part_1".to_string(), HeldEntry([5.0, 5.0, 5.0], "Ball", 0));

        let mut Commands = vec![PartCommand(
            "Part_1",
            "Cube",
            [0.0, 10.0, 0.0],
            [1.0, 0.0, 0.0],
        )];
        ApplyOwnershipMerge(&mut Commands, &mut Ownership, Instant::now());

        assert_eq!(
            PositionOf(&Commands[0]),
            [0.0, 10.0, 0.0],
            "mismatched signature must not be overridden"
        );
        assert_eq!(
            Ownership["Part_1"].missing_ticks, 1,
            "mismatch ages the entry toward removal"
        );
    }

    #[test]
    fn AbsentPartAgesOutAndIsDropped() {
        let mut Ownership = HashMap::new();
        let mut Entry = HeldEntry([5.0, 5.0, 5.0], "Ball", 0);
        Entry.missing_ticks = MISSING_TICKS_LIMIT;
        Ownership.insert("Part_1".to_string(), Entry);

        let mut Commands = vec![PartCommand(
            "Other",
            "Thing",
            [0.0, 0.0, 0.0],
            [1.0, 1.0, 1.0],
        )];
        ApplyOwnershipMerge(&mut Commands, &mut Ownership, Instant::now());

        assert!(
            Ownership.is_empty(),
            "an owned part absent past the limit must be dropped"
        );
    }
}
