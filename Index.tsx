import { useState } from "react";
import { Truck, MapPin, TrendingUp, Route, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatCard } from "@/components/Dashboard/StatCard";
import { RouteCard } from "@/components/Dashboard/RouteCard";
import { FileUpload } from "@/components/Dashboard/FileUpload";
import { VehicleConfig } from "@/components/Dashboard/VehicleConfig";
import { RouteMap } from "@/components/Map/RouteMap";
import { HistoryTable } from "@/components/History/HistoryTable";
import { toast } from "sonner";

const Index = () => {
  const [vehicleType, setVehicleType] = useState("hybrid");
  const [capacity, setCapacity] = useState(5500);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const handleFileSelect = (file: File) => {
    setSelectedFile(file);
  };

  const handleOptimize = () => {
    if (!selectedFile) {
      toast.error("Por favor, carga un archivo CSV primero");
      return;
    }
    toast.success("Optimizando rutas...", {
      description: "Esto puede tomar unos segundos",
    });
  };

  const routeColors = ["#10b981", "#3b82f6", "#f59e0b"];

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/50 glass-effect sticky top-0 z-50 shadow-lg">
        <div className="container mx-auto px-6 py-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="relative p-3 bg-gradient-to-br from-primary via-primary-glow to-secondary rounded-2xl shadow-lg hover:scale-105 transition-transform duration-300">
                <Truck className="w-7 h-7 text-white" />
                <div className="absolute inset-0 bg-white/20 rounded-2xl animate-pulse" />
              </div>
              <div>
                <h1 className="text-3xl font-bold gradient-text tracking-tight">RECONECTA</h1>
                <p className="text-sm text-muted-foreground font-medium">Sistema de Optimización de Rutas VRP</p>
              </div>
            </div>
            <Button 
              onClick={handleOptimize}
              size="lg"
              className="bg-gradient-to-r from-primary via-primary-glow to-secondary hover:shadow-2xl hover:scale-105 transition-all duration-300 text-base font-semibold px-6"
            >
              <Sparkles className="w-5 h-5 mr-2" />
              Calcular Rutas Optimizadas
            </Button>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-6 py-8">
        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <StatCard
            title="Rutas Activas"
            value="3"
            icon={Route}
            trend={{ value: "+2 esta semana", isPositive: true }}
            color="primary"
          />
          <StatCard
            title="Ubicaciones"
            value="24"
            icon={MapPin}
            trend={{ value: "+8 nuevas", isPositive: true }}
            color="secondary"
          />
          <StatCard
            title="Distancia Total"
            value="156 km"
            icon={TrendingUp}
            trend={{ value: "-12% optimizado", isPositive: true }}
            color="accent"
          />
          <StatCard
            title="Capacidad Usada"
            value="82%"
            icon={Truck}
            color="primary"
          />
        </div>

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          {/* Left Sidebar - Config */}
          <div className="lg:col-span-1 space-y-6">
            <FileUpload onFileSelect={handleFileSelect} />
            <VehicleConfig
              vehicleType={vehicleType}
              capacity={capacity}
              onVehicleTypeChange={setVehicleType}
              onCapacityChange={setCapacity}
            />

            {/* Routes List */}
            <div className="space-y-4">
              <div className="flex items-center justify-between px-2">
                <h3 className="text-xl font-bold text-foreground">Rutas Calculadas</h3>
                <Badge variant="outline" className="font-semibold">3 rutas</Badge>
              </div>
              <RouteCard
                routeNumber={1}
                color={routeColors[0]}
                locations={8}
                distance="52.3 km"
                duration="2h 15min"
                capacity="4,200 kg"
              />
              <RouteCard
                routeNumber={2}
                color={routeColors[1]}
                locations={9}
                distance="61.7 km"
                duration="2h 45min"
                capacity="5,100 kg"
              />
              <RouteCard
                routeNumber={3}
                color={routeColors[2]}
                locations={7}
                distance="42.1 km"
                duration="1h 50min"
                capacity="3,800 kg"
              />
            </div>
          </div>

          {/* Map - Takes 2 columns */}
          <div className="lg:col-span-2">
            <RouteMap />
          </div>
        </div>

        {/* History Section */}
        <HistoryTable />
      </div>
    </div>
  );
};

export default Index;
