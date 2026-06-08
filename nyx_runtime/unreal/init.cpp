// Nyx Engine - Unreal Runtime Shim
#include <algorithm>
#include <cmath>
#include <iomanip>
#include <sstream>
#include <string>
#include <unordered_map>
#include <utility>
#include <vector>

namespace NyxUnreal
{
    using FString = std::string;
    using FName = std::string;
    static const FName NAME_None = "None";

    struct FVector
    {
        float X = 0.0f;
        float Y = 0.0f;
        float Z = 0.0f;

        FVector() = default;
        FVector(float InX, float InY, float InZ) : X(InX), Y(InY), Z(InZ) {}

        static FVector ZeroVector() { return FVector(0.0f, 0.0f, 0.0f); }
        static FVector OneVector() { return FVector(1.0f, 1.0f, 1.0f); }
        static FVector UpVector() { return FVector(0.0f, 0.0f, 1.0f); }
        static FVector ForwardVector() { return FVector(1.0f, 0.0f, 0.0f); }
        static FVector RightVector() { return FVector(0.0f, 1.0f, 0.0f); }

        FVector operator+(const FVector& Other) const { return FVector(X + Other.X, Y + Other.Y, Z + Other.Z); }
        FVector operator-(const FVector& Other) const { return FVector(X - Other.X, Y - Other.Y, Z - Other.Z); }
        FVector operator*(float Scale) const { return FVector(X * Scale, Y * Scale, Z * Scale); }
        FVector operator/(float Scale) const { return FVector(X / Scale, Y / Scale, Z / Scale); }

        float Size() const { return std::sqrt(X * X + Y * Y + Z * Z); }
        FVector GetSafeNormal() const
        {
            const float Len = Size();
            return Len <= 0.0001f ? FVector() : *this / Len;
        }
    };

    struct FRotator
    {
        float Pitch = 0.0f;
        float Yaw = 0.0f;
        float Roll = 0.0f;

        FRotator() = default;
        FRotator(float InPitch, float InYaw, float InRoll) : Pitch(InPitch), Yaw(InYaw), Roll(InRoll) {}
    };

    struct FLinearColor
    {
        float R = 1.0f;
        float G = 1.0f;
        float B = 1.0f;
        float A = 1.0f;

        FLinearColor() = default;
        FLinearColor(float InR, float InG, float InB, float InA = 1.0f) : R(InR), G(InG), B(InB), A(InA) {}

        static FLinearColor White() { return FLinearColor(1.0f, 1.0f, 1.0f); }
        static FLinearColor Black() { return FLinearColor(0.0f, 0.0f, 0.0f); }
        static FLinearColor Gray() { return FLinearColor(0.64f, 0.64f, 0.65f); }
        static FLinearColor Red() { return FLinearColor(1.0f, 0.0f, 0.0f); }
        static FLinearColor Green() { return FLinearColor(0.0f, 1.0f, 0.0f); }
        static FLinearColor Blue() { return FLinearColor(0.0f, 0.0f, 1.0f); }
    };

    struct FTransform
    {
        FVector Location;
        FRotator Rotation;
        FVector Scale3D = FVector(100.0f, 100.0f, 100.0f);

        FTransform() = default;
        FTransform(const FRotator& InRotation, const FVector& InLocation, const FVector& InScale)
            : Location(InLocation), Rotation(InRotation), Scale3D(InScale) {}
    };

    namespace ECollisionEnabled
    {
        enum Type
        {
            NoCollision,
            QueryOnly,
            PhysicsOnly,
            QueryAndPhysics
        };
    }

    struct FNyxValue
    {
        enum class EKind { Null, Bool, Number, String, Object };

        EKind Kind = EKind::Null;
        bool BoolValue = false;
        double NumberValue = 0.0;
        std::string StringValue;
        std::unordered_map<std::string, FNyxValue> ObjectValue;

        FNyxValue() = default;
        FNyxValue(bool Value) : Kind(EKind::Bool), BoolValue(Value) {}
        FNyxValue(int Value) : Kind(EKind::Number), NumberValue(static_cast<double>(Value)) {}
        FNyxValue(float Value) : Kind(EKind::Number), NumberValue(static_cast<double>(Value)) {}
        FNyxValue(double Value) : Kind(EKind::Number), NumberValue(Value) {}
        FNyxValue(const char* Value) : Kind(EKind::String), StringValue(Value ? Value : "") {}
        FNyxValue(std::string Value) : Kind(EKind::String), StringValue(std::move(Value)) {}
        FNyxValue(std::unordered_map<std::string, FNyxValue> Value) : Kind(EKind::Object), ObjectValue(std::move(Value)) {}
    };

    using FNyxCommand = std::unordered_map<std::string, FNyxValue>;

    class AActor;

    class UActorComponent
    {
    public:
        AActor* Owner = nullptr;
        virtual ~UActorComponent() = default;
        virtual void Attach(AActor* InOwner) { Owner = InOwner; }
    };

    class UPrimitiveComponent : public UActorComponent
    {
    public:
        bool bSimulatePhysics = false;
        bool bEnableGravity = true;
        bool bCollisionEnabled = true;
        bool bMassless = false;
        float MassInKg = 1.0f;
        float LinearDamping = 0.01f;
        float AngularDamping = 0.0f;
        float Friction = 0.7f;
        float Restitution = 0.0f;
        FVector LinearVelocity;
        FVector AngularVelocity;
        FVector Force;
        FVector Impulse;
        std::string Material = "Default";
        std::string Shape = "Block";

        void SetSimulatePhysics(bool bValue) { bSimulatePhysics = bValue; }
        void SetEnableGravity(bool bValue) { bEnableGravity = bValue; }
        void SetCollisionEnabled(ECollisionEnabled::Type Mode)
        {
            bCollisionEnabled = Mode != ECollisionEnabled::NoCollision;
        }
        void SetMassOverrideInKg(float Mass, bool bOverrideMass = true)
        {
            if (bOverrideMass)
            {
                MassInKg = Mass;
            }
        }
        void SetMassOverrideInKg(const FName&, float Mass, bool bOverrideMass = true)
        {
            SetMassOverrideInKg(Mass, bOverrideMass);
        }
        void SetPhysicsLinearVelocity(FVector Velocity) { LinearVelocity = Velocity; }
        void SetPhysicsAngularVelocityInRadians(FVector Velocity) { AngularVelocity = Velocity; }

        void AddForce(FVector InForce)
        {
            Force = Force + InForce;
        }

        void AddImpulse(FVector InImpulse)
        {
            Impulse = Impulse + InImpulse;
            const float SafeMass = std::max(MassInKg, 0.001f);
            LinearVelocity = LinearVelocity + InImpulse * (1.0f / SafeMass);
        }
    };

    class UStaticMeshComponent : public UPrimitiveComponent
    {
    public:
        UStaticMeshComponent()
        {
            Shape = "Block";
        }
    };

    class ULightComponent : public UPrimitiveComponent
    {
    public:
        std::string LightType = "Point";
        FLinearColor LightColor = FLinearColor::White();
        float Intensity = 1.0f;
        float AttenuationRadius = 1000.0f;
        float OuterConeAngle = 44.0f;

        ULightComponent()
        {
            bCollisionEnabled = false;
            bSimulatePhysics = false;
            Shape = "Light";
        }

        void SetLightColor(FLinearColor InColor) { LightColor = InColor; }
        void SetIntensity(float InIntensity) { Intensity = InIntensity; }
    };

    class UDirectionalLightComponent : public ULightComponent
    {
    public:
        UDirectionalLightComponent()
        {
            LightType = "Directional";
        }
    };

    class UPointLightComponent : public ULightComponent
    {
    public:
        UPointLightComponent()
        {
            LightType = "Point";
        }
    };

    class USpotLightComponent : public ULightComponent
    {
    public:
        USpotLightComponent()
        {
            LightType = "Point";
        }
    };

    class AActor
    {
    private:
        static int NextId;
        std::vector<UActorComponent*> Components;

    protected:
        template <typename TComponent>
        TComponent* CreateDefaultComponent()
        {
            TComponent* Component = new TComponent();
            AddOwnedComponent(Component);
            return Component;
        }

    public:
        std::string NyxId;
        std::string Name = "Actor";
        FTransform Transform;
        UPrimitiveComponent* RootComponent = nullptr;
        FLinearColor Color = FLinearColor(0.64f, 0.64f, 0.65f);
        bool bHidden = false;
        bool bDestroyed = false;

        AActor()
        {
            NextId++;
            NyxId = "UnrealActor_" + std::to_string(NextId);
            RootComponent = CreateDefaultComponent<UStaticMeshComponent>();
        }

        virtual ~AActor()
        {
            for (UActorComponent* Component : Components)
            {
                delete Component;
            }
        }

        FVector GetActorLocation() const { return Transform.Location; }
        FRotator GetActorRotation() const { return Transform.Rotation; }
        FVector GetActorScale3D() const { return Transform.Scale3D; }
        FTransform GetActorTransform() const { return Transform; }
        UPrimitiveComponent* GetRootComponent() const { return RootComponent; }

        void SetActorLocation(FVector Location) { Transform.Location = Location; }
        void SetActorRotation(FRotator Rotation) { Transform.Rotation = Rotation; }
        void SetActorScale3D(FVector Scale3D) { Transform.Scale3D = Scale3D; }
        void SetActorTransform(const FTransform& InTransform) { Transform = InTransform; }
        void SetActorHiddenInGame(bool bValue) { bHidden = bValue; }
        void Destroy() { bDestroyed = true; }

        template <typename TComponent>
        TComponent* AddComponent()
        {
            return CreateDefaultComponent<TComponent>();
        }

        template <typename TComponent>
        TComponent* FindComponentByClass() const
        {
            for (UActorComponent* Component : Components)
            {
                if (TComponent* Match = dynamic_cast<TComponent*>(Component))
                {
                    return Match;
                }
            }
            return nullptr;
        }

        void AddOwnedComponent(UActorComponent* Component)
        {
            if (!Component) return;
            Component->Attach(this);
            Components.push_back(Component);
        }

        void SetRootComponent(UPrimitiveComponent* Component)
        {
            if (!Component) return;
            Component->Attach(this);
            RootComponent = Component;
            if (std::find(Components.begin(), Components.end(), Component) == Components.end())
            {
                Components.push_back(Component);
            }
        }
    };

    int AActor::NextId = 0;

    class AStaticMeshActor : public AActor
    {
    public:
        UStaticMeshComponent* GetStaticMeshComponent() const
        {
            return dynamic_cast<UStaticMeshComponent*>(RootComponent);
        }
    };

    class ADirectionalLight : public AActor
    {
    public:
        ADirectionalLight()
        {
            SetRootComponent(CreateDefaultComponent<UDirectionalLightComponent>());
            Name = "DirectionalLight";
        }

        UDirectionalLightComponent* GetLightComponent() const
        {
            return dynamic_cast<UDirectionalLightComponent*>(RootComponent);
        }
    };

    class APointLight : public AActor
    {
    public:
        APointLight()
        {
            SetRootComponent(CreateDefaultComponent<UPointLightComponent>());
            Name = "PointLight";
        }

        UPointLightComponent* GetLightComponent() const
        {
            return dynamic_cast<UPointLightComponent*>(RootComponent);
        }
    };

    class UNyxRuntime
    {
    public:
        static inline std::vector<FNyxCommand> Commands;
        static inline std::vector<std::string> Terminal;

        static FNyxValue Vec(const FVector& Value)
        {
            return FNyxValue({
                {"X", FNyxValue(Value.X)},
                {"Y", FNyxValue(Value.Z)},
                {"Z", FNyxValue(Value.Y)},
            });
        }

        static FNyxValue Colour(const FLinearColor& Value)
        {
            return FNyxValue({
                {"R", FNyxValue(Value.R)},
                {"G", FNyxValue(Value.G)},
                {"B", FNyxValue(Value.B)},
            });
        }

        static FNyxValue Frame(const FTransform& Transform)
        {
            return FNyxValue({
                {"X", FNyxValue(Transform.Location.X)},
                {"Y", FNyxValue(Transform.Location.Z)},
                {"Z", FNyxValue(Transform.Location.Y)},
                {"RX", FNyxValue(Transform.Rotation.Roll)},
                {"RY", FNyxValue(Transform.Rotation.Yaw)},
                {"RZ", FNyxValue(Transform.Rotation.Pitch)},
            });
        }

        static void EmitActor(const AActor& Actor)
        {
            UpsertCommand(ActorCommand(Actor));
        }

        static void RemoveActor(const AActor& Actor)
        {
            RemovePart(Actor.NyxId);
        }

        static std::string CommandsToJson()
        {
            return CommandsToJson(Commands);
        }

        static std::string CommandsToJson(const std::vector<AActor*>& Actors)
        {
            std::vector<FNyxCommand> SceneCommands = Commands;
            for (const AActor* Actor : Actors)
            {
                if (!Actor || Actor->bDestroyed)
                {
                    continue;
                }

                SceneCommands.erase(
                    std::remove_if(SceneCommands.begin(), SceneCommands.end(), [&](const FNyxCommand& Command)
                    {
                        const auto Cmd = Command.find("Cmd");
                        const auto Id = Command.find("Id");
                        return Cmd != Command.end() && Cmd->second.StringValue == "AddPart" &&
                               Id != Command.end() && Id->second.StringValue == Actor->NyxId;
                    }),
                    SceneCommands.end());
                SceneCommands.push_back(ActorCommand(*Actor));
            }
            return CommandsToJson(SceneCommands);
        }

        static void SetCamera(FVector Position, FVector LookAt)
        {
            Commands.push_back({
                {"Cmd", FNyxValue("SetCamera")},
                {"Position", Vec(Position)},
                {"LookAt", Vec(LookAt)},
            });
        }

        static void SetSkybox(FLinearColor Color)
        {
            Commands.push_back({
                {"Cmd", FNyxValue("SetSkybox")},
                {"Color", Colour(Color)},
            });
        }

        static void AddDirectionalLight(FVector Position, FLinearColor Color, float Intensity = 1.0f)
        {
            Commands.push_back({
                {"Cmd", FNyxValue("AddLight")},
                {"LightType", FNyxValue("Directional")},
                {"Position", Vec(Position)},
                {"Color", Colour(Color)},
                {"Intensity", FNyxValue(Intensity)},
            });
        }

        static void AddPointLight(FVector Position, FLinearColor Color, float Intensity = 1.0f)
        {
            Commands.push_back({
                {"Cmd", FNyxValue("AddLight")},
                {"LightType", FNyxValue("Point")},
                {"Position", Vec(Position)},
                {"Color", Colour(Color)},
                {"Intensity", FNyxValue(Intensity)},
            });
        }

        static std::string ToJson(const FNyxValue& Value)
        {
            switch (Value.Kind)
            {
                case FNyxValue::EKind::Null:
                    return "null";
                case FNyxValue::EKind::Bool:
                    return Value.BoolValue ? "true" : "false";
                case FNyxValue::EKind::Number:
                {
                    std::ostringstream Stream;
                    Stream << std::setprecision(8) << Value.NumberValue;
                    return Stream.str();
                }
                case FNyxValue::EKind::String:
                    return Quote(Value.StringValue);
                case FNyxValue::EKind::Object:
                {
                    std::vector<std::string> Parts;
                    for (const auto& Pair : Value.ObjectValue)
                    {
                        Parts.push_back(Quote(Pair.first) + ":" + ToJson(Pair.second));
                    }
                    return "{" + Join(Parts) + "}";
                }
            }
            return "null";
        }

        static std::string CommandsToJson(const std::vector<FNyxCommand>& SourceCommands)
        {
            std::vector<std::string> Parts;
            for (const FNyxCommand& Command : SourceCommands)
            {
                Parts.push_back(ToJson(FNyxValue(Command)));
            }
            return "[" + Join(Parts) + "]";
        }

        static std::string Quote(const std::string& Value)
        {
            std::string Out = "\"";
            for (char Ch : Value)
            {
                if (Ch == '\\' || Ch == '"')
                {
                    Out.push_back('\\');
                }
                if (Ch == '\n') { Out += "\\n"; continue; }
                if (Ch == '\r') { Out += "\\r"; continue; }
                if (Ch == '\t') { Out += "\\t"; continue; }
                Out.push_back(Ch);
            }
            Out.push_back('"');
            return Out;
        }

        static std::string Join(const std::vector<std::string>& Parts)
        {
            std::string Out;
            for (size_t Index = 0; Index < Parts.size(); ++Index)
            {
                if (Index > 0)
                {
                    Out += ",";
                }
                Out += Parts[Index];
            }
            return Out;
        }

    private:
        static FNyxCommand ActorCommand(const AActor& Actor)
        {
            const UPrimitiveComponent* Component = Actor.RootComponent;
            if (const ULightComponent* Light = dynamic_cast<const ULightComponent*>(Component))
            {
                return {
                    {"Cmd", FNyxValue("AddLight")},
                    {"LightType", FNyxValue(Light->LightType)},
                    {"Position", Vec(Actor.Transform.Location)},
                    {"Color", Colour(Light->LightColor)},
                    {"Intensity", FNyxValue(Light->Intensity)},
                };
            }

            const bool bDynamic = Component && Component->bSimulatePhysics;

            return {
                {"Cmd", FNyxValue("AddPart")},
                {"Id", FNyxValue(Actor.NyxId)},
                {"Name", FNyxValue(Actor.Name)},
                {"Position", Vec(Actor.Transform.Location)},
                {"Size", Vec(Actor.Transform.Scale3D)},
                {"Color", Colour(Actor.Color)},
                {"CFrame", Frame(Actor.Transform)},
                {"Anchored", FNyxValue(!bDynamic)},
                {"CanCollide", FNyxValue(Component ? Component->bCollisionEnabled : true)},
                {"Transparency", FNyxValue(Actor.Color.A >= 1.0f ? 0.0f : 1.0f - Actor.Color.A)},
                {"Material", FNyxValue(Component ? Component->Material : "Default")},
                {"Shape", FNyxValue(Component ? Component->Shape : "Block")},
                {"AssemblyLinearVelocity", Vec(Component ? Component->LinearVelocity : FVector())},
                {"Velocity", Vec(Component ? Component->LinearVelocity : FVector())},
                {"AssemblyAngularVelocity", Vec(Component ? Component->AngularVelocity : FVector())},
                {"RotVelocity", Vec(Component ? Component->AngularVelocity : FVector())},
                {"Force", Vec(Component ? Component->Force : FVector())},
                {"Impulse", Vec(Component ? Component->Impulse : FVector())},
                {"Massless", FNyxValue(Component ? Component->bMassless : false)},
                {"Mass", FNyxValue(Component ? Component->MassInKg : 0.0f)},
                {"Density", FNyxValue(1.0f)},
                {"Friction", FNyxValue(Component ? Component->Friction : 0.7f)},
                {"Elasticity", FNyxValue(Component ? Component->Restitution : 0.0f)},
            };
        }

        static void UpsertCommand(FNyxCommand Command)
        {
            const auto Id = Command.find("Id");
            if (Id == Command.end())
            {
                Commands.push_back(std::move(Command));
                return;
            }

            for (FNyxCommand& Existing : Commands)
            {
                const auto ExistingCmd = Existing.find("Cmd");
                const auto ExistingId = Existing.find("Id");
                if (ExistingCmd != Existing.end() && ExistingCmd->second.StringValue == "AddPart" &&
                    ExistingId != Existing.end() && ExistingId->second.StringValue == Id->second.StringValue)
                {
                    Existing = std::move(Command);
                    return;
                }
            }

            Commands.push_back(std::move(Command));
        }

        static void RemovePart(const std::string& Id)
        {
            Commands.erase(
                std::remove_if(Commands.begin(), Commands.end(), [&](const FNyxCommand& Command)
                {
                    const auto Cmd = Command.find("Cmd");
                    const auto ExistingId = Command.find("Id");
                    return Cmd != Command.end() && Cmd->second.StringValue == "AddPart" &&
                           ExistingId != Command.end() && ExistingId->second.StringValue == Id;
                }),
                Commands.end());
        }
    };

    inline void UE_LOG(const std::string& Message)
    {
        UNyxRuntime::Terminal.push_back(Message);
    }

    class UWorld
    {
    public:
        FVector Gravity = FVector(0.0f, 0.0f, -980.0f);
        std::vector<AActor*> Actors;

        ~UWorld()
        {
            for (AActor* Actor : Actors)
            {
                delete Actor;
            }
        }

        template <typename TActor = AActor>
        TActor* SpawnActor(std::string Name = "Actor")
        {
            TActor* Actor = new TActor();
            Actor->Name = std::move(Name);
            Actors.push_back(Actor);
            UNyxRuntime::EmitActor(*Actor);
            return Actor;
        }

        template <typename TActor = AActor>
        TActor* SpawnActor(const FVector& Location, const FRotator& Rotation = FRotator())
        {
            TActor* Actor = SpawnActor<TActor>();
            Actor->SetActorLocation(Location);
            Actor->SetActorRotation(Rotation);
            UNyxRuntime::EmitActor(*Actor);
            return Actor;
        }

        bool DestroyActor(AActor* Actor)
        {
            if (!Actor) return false;
            Actor->Destroy();
            UNyxRuntime::RemoveActor(*Actor);
            return true;
        }

        void SetGravityZ(float GravityZ)
        {
            Gravity = FVector(0.0f, 0.0f, GravityZ);
            UNyxRuntime::Commands.push_back({
                {"Cmd", FNyxValue("SetGravity")},
                {"Value", FNyxValue(std::abs(GravityZ))},
            });
        }

        void SetSkybox(FLinearColor Color)
        {
            UNyxRuntime::SetSkybox(Color);
        }

        ADirectionalLight* AddDirectionalLight(FVector Position, FLinearColor Color, float Intensity = 1.0f)
        {
            ADirectionalLight* LightActor = SpawnActor<ADirectionalLight>("DirectionalLight");
            LightActor->SetActorLocation(Position);
            if (UDirectionalLightComponent* Light = LightActor->GetLightComponent())
            {
                Light->SetLightColor(Color);
                Light->SetIntensity(Intensity);
            }
            UNyxRuntime::EmitActor(*LightActor);
            return LightActor;
        }

        APointLight* AddPointLight(FVector Position, FLinearColor Color, float Intensity = 1.0f)
        {
            APointLight* LightActor = SpawnActor<APointLight>("PointLight");
            LightActor->SetActorLocation(Position);
            if (UPointLightComponent* Light = LightActor->GetLightComponent())
            {
                Light->SetLightColor(Color);
                Light->SetIntensity(Intensity);
            }
            UNyxRuntime::EmitActor(*LightActor);
            return LightActor;
        }

        void SetCamera(FVector Position, FVector LookAt)
        {
            UNyxRuntime::SetCamera(Position, LookAt);
        }

        std::string CommandsToJson() const
        {
            return UNyxRuntime::CommandsToJson(Actors);
        }
    };
}
