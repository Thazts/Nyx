// Nyx Engine     Unity Runtime Shim
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace UnityEngine
{
    public struct Vector3
    {
        public float X;
        public float Y;
        public float Z;

        public float x { get => X; set => X = value; }
        public float y { get => Y; set => Y = value; }
        public float z { get => Z; set => Z = value; }

        public Vector3(float X, float Y, float Z)
        {
            this.X = X;
            this.Y = Y;
            this.Z = Z;
        }

        public static Vector3 Zero => new Vector3(0f, 0f, 0f);
        public static Vector3 One => new Vector3(1f, 1f, 1f);
        public static Vector3 Up => new Vector3(0f, 1f, 0f);
        public static Vector3 Down => new Vector3(0f, -1f, 0f);
        public static Vector3 Right => new Vector3(1f, 0f, 0f);
        public static Vector3 Left => new Vector3(-1f, 0f, 0f);
        public static Vector3 Forward => new Vector3(0f, 0f, 1f);
        public static Vector3 Back => new Vector3(0f, 0f, -1f);

        public static Vector3 zero => Zero;
        public static Vector3 one => One;
        public static Vector3 up => Up;
        public static Vector3 down => Down;
        public static Vector3 right => Right;
        public static Vector3 left => Left;
        public static Vector3 forward => Forward;
        public static Vector3 back => Back;

        public static Vector3 operator +(Vector3 A, Vector3 B) => new Vector3(A.X + B.X, A.Y + B.Y, A.Z + B.Z);
        public static Vector3 operator -(Vector3 A, Vector3 B) => new Vector3(A.X - B.X, A.Y - B.Y, A.Z - B.Z);
        public static Vector3 operator -(Vector3 A) => new Vector3(-A.X, -A.Y, -A.Z);
        public static Vector3 operator *(Vector3 A, float B) => new Vector3(A.X * B, A.Y * B, A.Z * B);
        public static Vector3 operator *(float A, Vector3 B) => B * A;
        public static Vector3 operator /(Vector3 A, float B) => new Vector3(A.X / B, A.Y / B, A.Z / B);

        public float Magnitude => (float)Math.Sqrt(X * X + Y * Y + Z * Z);
        public Vector3 Normalized => Magnitude <= 0.0001f ? Zero : this / Magnitude;

        public static float Dot(Vector3 A, Vector3 B) => A.X * B.X + A.Y * B.Y + A.Z * B.Z;
        public static Vector3 Cross(Vector3 A, Vector3 B) => new Vector3(
            A.Y * B.Z - A.Z * B.Y,
            A.Z * B.X - A.X * B.Z,
            A.X * B.Y - A.Y * B.X);
        public static Vector3 Lerp(Vector3 A, Vector3 B, float T) => A + (B - A) * Mathf.Clamp01(T);
    }

    public struct Color
    {
        public float R;
        public float G;
        public float B;
        public float A;

        public float r { get => R; set => R = value; }
        public float g { get => G; set => G = value; }
        public float b { get => B; set => B = value; }
        public float a { get => A; set => A = value; }

        public Color(float R, float G, float B, float A = 1f)
        {
            this.R = R;
            this.G = G;
            this.B = B;
            this.A = A;
        }

        public static Color White => new Color(1f, 1f, 1f);
        public static Color Black => new Color(0f, 0f, 0f);
        public static Color Gray => new Color(0.64f, 0.64f, 0.65f);
        public static Color Red => new Color(1f, 0f, 0f);
        public static Color Green => new Color(0f, 1f, 0f);
        public static Color Blue => new Color(0f, 0f, 1f);
        public static Color Yellow => new Color(1f, 0.92f, 0.016f);
        public static Color Cyan => new Color(0f, 1f, 1f);
        public static Color Magenta => new Color(1f, 0f, 1f);

        public static Color white => White;
        public static Color black => Black;
        public static Color gray => Gray;
        public static Color grey => Gray;
        public static Color red => Red;
        public static Color green => Green;
        public static Color blue => Blue;
        public static Color yellow => Yellow;
        public static Color cyan => Cyan;
        public static Color magenta => Magenta;

        public static Color Lerp(Color A, Color B, float T)
        {
            T = Mathf.Clamp01(T);
            return new Color(
                A.R + (B.R - A.R) * T,
                A.G + (B.G - A.G) * T,
                A.B + (B.B - A.B) * T,
                A.A + (B.A - A.A) * T);
        }
    }

    public struct Quaternion
    {
        public float X;
        public float Y;
        public float Z;
        public float W;

        public float x { get => X; set => X = value; }
        public float y { get => Y; set => Y = value; }
        public float z { get => Z; set => Z = value; }
        public float w { get => W; set => W = value; }

        public Quaternion(float X, float Y, float Z, float W)
        {
            this.X = X;
            this.Y = Y;
            this.Z = Z;
            this.W = W;
        }

        public static Quaternion Identity => new Quaternion(0f, 0f, 0f, 1f);
        public static Quaternion identity => Identity;

        public static Quaternion Euler(float X, float Y, float Z)
        {
            return new Quaternion(X, Y, Z, 1f);
        }

        public static Quaternion Euler(Vector3 EulerAngles)
        {
            return Euler(EulerAngles.X, EulerAngles.Y, EulerAngles.Z);
        }
    }

    public static class Mathf
    {
        public const float PI = 3.14159265359f;
        public static float Clamp01(float Value) => Value < 0f ? 0f : Value > 1f ? 1f : Value;
        public static float Max(float A, float B) => Math.Max(A, B);
        public static float Min(float A, float B) => Math.Min(A, B);
        public static float Abs(float Value) => Math.Abs(Value);
        public static float Sqrt(float Value) => (float)Math.Sqrt(Value);
        public static float Lerp(float A, float B, float T) => A + (B - A) * Clamp01(T);
    }

    public class Object
    {
        public string Name = "Object";
        public bool IsDestroyed { get; private set; }

        public string name
        {
            get => Name;
            set => Name = value;
        }

        public static void Destroy(Object Target)
        {
            if (Target == null) return;
            Target.IsDestroyed = true;
            if (Target is GameObject GameObject)
            {
                Scene.Remove(GameObject);
            }
            else if (Target is Component Component && Component.gameObject != null)
            {
                Scene.Remove(Component.gameObject);
            }
        }

        public static T Instantiate<T>(T Original) where T : Object
        {
            if (Original is GameObject GameObject)
            {
                return GameObject.Clone() as T;
            }
            return Original;
        }
    }

    public class Component : Object
    {
        public GameObject gameObject { get; internal set; }
        public Transform transform => gameObject == null ? null : gameObject.Transform;

        internal virtual void Attach(GameObject Owner)
        {
            gameObject = Owner;
        }

        protected void NotifyChanged()
        {
            if (gameObject != null)
            {
                NyxRuntime.EmitGameObject(gameObject);
            }
        }
    }

    public sealed class Transform : Component
    {
        private Vector3 PositionValue = Vector3.Zero;
        private Vector3 LocalScaleValue = Vector3.One;
        private Quaternion RotationValue = Quaternion.Identity;

        public Vector3 Position { get => PositionValue; set { PositionValue = value; NotifyChanged(); } }
        public Vector3 LocalScale { get => LocalScaleValue; set { LocalScaleValue = value; NotifyChanged(); } }
        public Quaternion Rotation { get => RotationValue; set { RotationValue = value; NotifyChanged(); } }

        public Vector3 position { get => Position; set => Position = value; }
        public Vector3 localScale { get => LocalScale; set => LocalScale = value; }
        public Quaternion rotation { get => Rotation; set => Rotation = value; }

        public void Translate(Vector3 Delta)
        {
            Position = Position + Delta;
        }

        public void LookAt(Vector3 Target)
        {
            var Delta = Target - Position;
            var Horizontal = (float)Math.Sqrt(Delta.X * Delta.X + Delta.Z * Delta.Z);
            Rotation = Quaternion.Euler(
                (float)Math.Atan2(Delta.Y, Horizontal),
                (float)Math.Atan2(Delta.X, Delta.Z),
                0f);
        }
    }

    public enum PrimitiveType
    {
        Cube,
        Sphere,
        Cylinder,
        Capsule,
        Plane,
        Quad
    }

    public enum ForceMode
    {
        Force,
        Acceleration,
        Impulse,
        VelocityChange
    }

    public sealed class PhysicMaterial
    {
        public string Name = "Default";
        public float DynamicFriction = 0.6f;
        public float StaticFriction = 0.6f;
        public float Bounciness = 0f;

        public string name { get => Name; set => Name = value; }
        public float dynamicFriction { get => DynamicFriction; set => DynamicFriction = value; }
        public float staticFriction { get => StaticFriction; set => StaticFriction = value; }
        public float bounciness { get => Bounciness; set => Bounciness = value; }
    }

    public sealed class Material
    {
        public string Name = "Default";
        public Color Color = Color.Gray;
        public PhysicMaterial Physics = new PhysicMaterial();

        public string name { get => Name; set => Name = value; }
        public Color color { get => Color; set => Color = value; }
    }

    public sealed class Renderer : Component
    {
        public Material Material = new Material();
        public bool Enabled = true;

        public Material material { get => Material; set { Material = value ?? new Material(); NotifyChanged(); } }
        public bool enabled { get => Enabled; set { Enabled = value; NotifyChanged(); } }
    }

    public sealed class Rigidbody : Component
    {
        public float Mass = 1f;
        public float Drag = 0f;
        public float AngularDrag = 0.05f;
        public bool UseGravity = true;
        public bool IsKinematic = false;
        public Vector3 Velocity = Vector3.Zero;
        public Vector3 AngularVelocity = Vector3.Zero;
        internal Vector3 Force = Vector3.Zero;
        internal Vector3 Impulse = Vector3.Zero;

        public float mass { get => Mass; set { Mass = value; NotifyChanged(); } }
        public float drag { get => Drag; set { Drag = value; NotifyChanged(); } }
        public float angularDrag { get => AngularDrag; set { AngularDrag = value; NotifyChanged(); } }
        public bool useGravity { get => UseGravity; set { UseGravity = value; NotifyChanged(); } }
        public bool isKinematic { get => IsKinematic; set { IsKinematic = value; NotifyChanged(); } }
        public Vector3 velocity { get => Velocity; set { Velocity = value; NotifyChanged(); } }
        public Vector3 angularVelocity { get => AngularVelocity; set { AngularVelocity = value; NotifyChanged(); } }

        public void AddForce(Vector3 Force, ForceMode Mode = ForceMode.Force)
        {
            var SafeMass = Math.Max(Mass, 0.001f);
            if (Mode == ForceMode.Impulse || Mode == ForceMode.VelocityChange)
            {
                Impulse += Mode == ForceMode.VelocityChange ? Force * SafeMass : Force;
                Velocity += Force / SafeMass;
            }
            else
            {
                this.Force += Mode == ForceMode.Acceleration ? Force * SafeMass : Force;
            }
            NotifyChanged();
        }
    }

    public enum LightType
    {
        Directional,
        Point,
        Spot,
        Area
    }

    public sealed class Light : Component
    {
        public LightType Type = LightType.Point;
        public Color Color = Color.White;
        public float Intensity = 1f;
        public float Range = 10f;
        public float SpotAngle = 30f;

        public LightType type { get => Type; set { Type = value; Emit(); } }
        public Color color { get => Color; set { Color = value; Emit(); } }
        public float intensity { get => Intensity; set { Intensity = value; Emit(); } }
        public float range { get => Range; set { Range = value; Emit(); } }
        public float spotAngle { get => SpotAngle; set { SpotAngle = value; Emit(); } }

        private void Emit()
        {
            if (gameObject == null) return;
            NyxRuntime.EmitLight(this);
        }
    }

    public sealed class Camera : Component
    {
        public static readonly Camera main = new Camera();
        public float FieldOfView = 60f;
        public float fieldOfView { get => FieldOfView; set => FieldOfView = value; }

        static Camera()
        {
            var CameraObject = new GameObject("Main Camera", false);
            main.Attach(CameraObject);
        }

        public void LookAt(Vector3 Target)
        {
            transform?.LookAt(Target);
            SetPosition(transform == null ? Vector3.Zero : transform.Position, Target);
        }

        public static void SetPosition(Vector3 Position, Vector3 LookAt)
        {
            NyxRuntime.Commands.Add(new Dictionary<string, object>
            {
                ["Cmd"] = "SetCamera",
                ["Position"] = NyxRuntime.Vec(Position),
                ["LookAt"] = NyxRuntime.Vec(LookAt),
            });
        }
    }

    public sealed class GameObject : Object
    {
        private static int NextId = 0;
        private readonly List<Component> Components = new List<Component>();

        public readonly string NyxId;
        public Transform Transform { get; private set; }
        public Renderer Renderer { get; private set; }
        public bool ActiveSelf = true;
        public PrimitiveType Shape = PrimitiveType.Cube;
        public Rigidbody Rigidbody;

        public Transform transform => Transform;
        public bool activeSelf => ActiveSelf;
        public Color Color { get => Renderer.Material.Color; set { Renderer.Material.Color = value; NyxRuntime.EmitGameObject(this); } }
        public string Material { get => Renderer.Material.Name; set { Renderer.Material.Name = value ?? "Default"; NyxRuntime.EmitGameObject(this); } }

        public GameObject(string Name = "GameObject") : this(Name, true) {}

        internal GameObject(string Name, bool AddToScene)
        {
            NextId++;
            NyxId = "UnityObject_" + NextId.ToString(CultureInfo.InvariantCulture);
            this.Name = Name;
            Transform = new Transform();
            Renderer = new Renderer();
            AddExistingComponent(Transform);
            AddExistingComponent(Renderer);
            if (AddToScene)
            {
                Scene.Add(this);
            }
        }

        public static GameObject CreatePrimitive(PrimitiveType Type)
        {
            var Object = new GameObject(Type.ToString());
            Object.Shape = Type;
            return Object;
        }

        public void SetActive(bool Value)
        {
            ActiveSelf = Value;
            NyxRuntime.EmitGameObject(this);
        }

        public T AddComponent<T>() where T : Component, new()
        {
            var Component = new T();
            AddExistingComponent(Component);
            if (Component is Rigidbody Body)
            {
                Rigidbody = Body;
            }
            return Component;
        }

        public T GetComponent<T>() where T : Component
        {
            foreach (var Component in Components)
            {
                if (Component is T Match)
                {
                    return Match;
                }
            }
            return null;
        }

        internal GameObject Clone()
        {
            var Copy = new GameObject(Name);
            Copy.Shape = Shape;
            Copy.Transform.Position = Transform.Position;
            Copy.Transform.LocalScale = Transform.LocalScale;
            Copy.Transform.Rotation = Transform.Rotation;
            Copy.Renderer.Material.Name = Renderer.Material.Name;
            Copy.Renderer.Material.Color = Renderer.Material.Color;
            Copy.ActiveSelf = ActiveSelf;
            if (Rigidbody != null)
            {
                var Body = Copy.AddComponent<Rigidbody>();
                Body.Mass = Rigidbody.Mass;
                Body.Drag = Rigidbody.Drag;
                Body.AngularDrag = Rigidbody.AngularDrag;
                Body.UseGravity = Rigidbody.UseGravity;
                Body.IsKinematic = Rigidbody.IsKinematic;
                Body.Velocity = Rigidbody.Velocity;
                Body.AngularVelocity = Rigidbody.AngularVelocity;
            }
            return Copy;
        }

        private void AddExistingComponent(Component Component)
        {
            Component.Attach(this);
            Components.Add(Component);
        }
    }

    public class MonoBehaviour : Object
    {
        protected static void Destroy(Object Target) => Object.Destroy(Target);
        protected static T Instantiate<T>(T Original) where T : Object => Object.Instantiate(Original);
    }

    public static class Physics
    {
        public static Vector3 Gravity = new Vector3(0f, -9.81f, 0f);
        public static int DefaultSolverIterations = 6;
        public static float DefaultContactOffset = 0.01f;

        public static Vector3 gravity { get => Gravity; set { Gravity = value; Scene.SetGravity(Math.Abs(value.Y)); } }
        public static int defaultSolverIterations { get => DefaultSolverIterations; set => DefaultSolverIterations = value; }
        public static float defaultContactOffset { get => DefaultContactOffset; set => DefaultContactOffset = value; }
    }

    public static class Time
    {
        public static float FixedDeltaTime = 0.02f;
        public static float DeltaTime = 0.02f;
        public static float TimeSinceStartup = 0f;

        public static float fixedDeltaTime { get => FixedDeltaTime; set => FixedDeltaTime = value; }
        public static float deltaTime => DeltaTime;
        public static float time => TimeSinceStartup;
    }

    public static class Debug
    {
        public static void Log(object Message)
        {
            NyxRuntime.Terminal.Add(Message == null ? "null" : Message.ToString());
        }
    }

    public static class RenderSettings
    {
        public static Color AmbientLight = new Color(0.32f, 0.42f, 0.55f);
        public static Color SkyboxColor = new Color(0.32f, 0.42f, 0.55f);

        public static Color ambientLight { get => AmbientLight; set { AmbientLight = value; Scene.SetSkybox(value); } }
        public static Color skyboxColor { get => SkyboxColor; set { SkyboxColor = value; Scene.SetSkybox(value); } }
    }

    public static class Scene
    {
        public static readonly List<GameObject> Objects = new List<GameObject>();

        public static GameObject Add(GameObject Object)
        {
            if (Object != null && !Objects.Contains(Object))
            {
                Objects.Add(Object);
                NyxRuntime.EmitGameObject(Object);
            }
            return Object;
        }

        public static void Remove(GameObject Object)
        {
            if (Object == null) return;
            Objects.Remove(Object);
            NyxRuntime.RemovePart(Object.NyxId);
        }

        public static void SetGravity(float Value)
        {
            Physics.Gravity = new Vector3(0f, -Value, 0f);
            NyxRuntime.Commands.Add(new Dictionary<string, object>
            {
                ["Cmd"] = "SetGravity",
                ["Value"] = Value,
            });
        }

        public static void SetSkybox(Color Color)
        {
            RenderSettings.SkyboxColor = Color;
            NyxRuntime.Commands.Add(new Dictionary<string, object>
            {
                ["Cmd"] = "SetSkybox",
                ["Color"] = NyxRuntime.Colour(Color),
            });
        }

        public static Light AddDirectionalLight(Vector3 Position, Color Color, float Intensity = 1f)
        {
            var Object = new GameObject("Directional Light");
            Object.Transform.Position = Position;
            var Light = Object.AddComponent<Light>();
            Light.Type = LightType.Directional;
            Light.Color = Color;
            Light.Intensity = Intensity;
            NyxRuntime.EmitLight(Light);
            return Light;
        }

        public static Light AddPointLight(Vector3 Position, Color Color, float Intensity = 1f)
        {
            var Object = new GameObject("Point Light");
            Object.Transform.Position = Position;
            var Light = Object.AddComponent<Light>();
            Light.Type = LightType.Point;
            Light.Color = Color;
            Light.Intensity = Intensity;
            NyxRuntime.EmitLight(Light);
            return Light;
        }
    }

    public static class NyxRuntime
    {
        public static readonly List<Dictionary<string, object>> Commands = new List<Dictionary<string, object>>();
        public static readonly List<string> Terminal = new List<string>();

        public static Dictionary<string, object> Vec(Vector3 Value)
        {
            return new Dictionary<string, object>
            {
                ["X"] = Value.X,
                ["Y"] = Value.Y,
                ["Z"] = Value.Z,
            };
        }

        public static Dictionary<string, object> Colour(Color Value)
        {
            return new Dictionary<string, object>
            {
                ["R"] = Value.R,
                ["G"] = Value.G,
                ["B"] = Value.B,
            };
        }

        public static Dictionary<string, object> Frame(Transform Transform)
        {
            return new Dictionary<string, object>
            {
                ["X"] = Transform.Position.X,
                ["Y"] = Transform.Position.Y,
                ["Z"] = Transform.Position.Z,
                ["RX"] = Transform.Rotation.X,
                ["RY"] = Transform.Rotation.Y,
                ["RZ"] = Transform.Rotation.Z,
            };
        }

        public static void EmitGameObject(GameObject Object)
        {
            if (Object != null && !Object.IsDestroyed)
            {
                UpsertCommand(GameObjectCommand(Object));
            }
        }

        public static void EmitLight(Light Light)
        {
            if (Light == null || Light.gameObject == null) return;
            var Type = Light.Type == LightType.Directional ? "Directional" : "Point";
            Commands.Add(new Dictionary<string, object>
            {
                ["Cmd"] = "AddLight",
                ["LightType"] = Type,
                ["Position"] = Vec(Light.transform == null ? Vector3.Zero : Light.transform.Position),
                ["Color"] = Colour(Light.Color),
                ["Intensity"] = Light.Intensity,
            });
        }

        public static void RemovePart(string Id)
        {
            Commands.RemoveAll(Command =>
                Command.TryGetValue("Cmd", out var Cmd) && (Cmd as string) == "AddPart" &&
                Command.TryGetValue("Id", out var ExistingId) && (ExistingId as string) == Id);
        }

        public static string CommandsToJson()
        {
            return ToJson(BuildCommands());
        }

        private static List<Dictionary<string, object>> BuildCommands()
        {
            var Output = new List<Dictionary<string, object>>(Commands);
            foreach (var Object in Scene.Objects)
            {
                if (Object == null || Object.IsDestroyed) continue;
                Output.RemoveAll(Command =>
                    Command.TryGetValue("Cmd", out var Cmd) && (Cmd as string) == "AddPart" &&
                    Command.TryGetValue("Id", out var Id) && (Id as string) == Object.NyxId);
                Output.Add(GameObjectCommand(Object));
            }
            return Output;
        }

        private static void UpsertCommand(Dictionary<string, object> Command)
        {
            if (!Command.TryGetValue("Id", out var Id))
            {
                Commands.Add(Command);
                return;
            }

            for (var I = 0; I < Commands.Count; I++)
            {
                if (Commands[I].TryGetValue("Cmd", out var Cmd) && (Cmd as string) == "AddPart" &&
                    Commands[I].TryGetValue("Id", out var ExistingId) && (ExistingId as string) == (Id as string))
                {
                    Commands[I] = Command;
                    return;
                }
            }

            Commands.Add(Command);
        }

        private static Dictionary<string, object> GameObjectCommand(GameObject Object)
        {
            var Body = Object.Rigidbody;
            var Material = Object.Renderer == null ? new Material() : Object.Renderer.Material;
            var Shape = Object.Shape == PrimitiveType.Sphere ? "Sphere"
                : Object.Shape == PrimitiveType.Cylinder || Object.Shape == PrimitiveType.Capsule ? "Cylinder"
                : "Block";

            return new Dictionary<string, object>
            {
                ["Cmd"] = "AddPart",
                ["Id"] = Object.NyxId,
                ["Name"] = Object.Name,
                ["Position"] = Vec(Object.Transform.Position),
                ["Size"] = Vec(Object.Transform.LocalScale),
                ["Color"] = Colour(Material.Color),
                ["CFrame"] = Frame(Object.Transform),
                ["Anchored"] = Body == null || Body.IsKinematic,
                ["CanCollide"] = Object.ActiveSelf,
                ["Transparency"] = Material.Color.A >= 1f ? 0f : 1f - Material.Color.A,
                ["Material"] = Material.Name,
                ["Shape"] = Shape,
                ["AssemblyLinearVelocity"] = Vec(Body == null ? Vector3.Zero : Body.Velocity),
                ["Velocity"] = Vec(Body == null ? Vector3.Zero : Body.Velocity),
                ["AssemblyAngularVelocity"] = Vec(Body == null ? Vector3.Zero : Body.AngularVelocity),
                ["RotVelocity"] = Vec(Body == null ? Vector3.Zero : Body.AngularVelocity),
                ["Force"] = Vec(Body == null ? Vector3.Zero : Body.Force),
                ["Impulse"] = Vec(Body == null ? Vector3.Zero : Body.Impulse),
                ["Massless"] = false,
                ["Mass"] = Body == null ? 0f : Body.Mass,
                ["Density"] = 1f,
                ["Friction"] = Material.Physics.DynamicFriction,
                ["Elasticity"] = Material.Physics.Bounciness,
            };
        }

        public static string ToJson(object Value)
        {
            if (Value == null) return "null";
            if (Value is bool Bool) return Bool ? "true" : "false";
            if (Value is int Int) return Int.ToString(CultureInfo.InvariantCulture);
            if (Value is float Float) return Float.ToString("0.########", CultureInfo.InvariantCulture);
            if (Value is double Double) return Double.ToString("0.########", CultureInfo.InvariantCulture);
            if (Value is string String) return Quote(String);
            if (Value is Dictionary<string, object> Object)
            {
                var Parts = new List<string>();
                foreach (var Pair in Object)
                {
                    Parts.Add(ToJson(Pair.Key) + ":" + ToJson(Pair.Value));
                }
                return "{" + string.Join(",", Parts) + "}";
            }
            if (Value is IEnumerable<Dictionary<string, object>> CommandList)
            {
                var Parts = new List<string>();
                foreach (var Command in CommandList)
                {
                    Parts.Add(ToJson(Command));
                }
                return "[" + string.Join(",", Parts) + "]";
            }
            return ToJson(Value.ToString());
        }

        private static string Quote(string Value)
        {
            var Builder = new StringBuilder();
            Builder.Append('"');
            foreach (var Ch in Value ?? "")
            {
                if (Ch == '\\' || Ch == '"') Builder.Append('\\');
                if (Ch == '\n') { Builder.Append("\\n"); continue; }
                if (Ch == '\r') { Builder.Append("\\r"); continue; }
                if (Ch == '\t') { Builder.Append("\\t"); continue; }
                Builder.Append(Ch);
            }
            Builder.Append('"');
            return Builder.ToString();
        }
    }
}
