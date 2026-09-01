import { useEffect, useRef, useState } from 'react';
import { useAuth } from './hooks/useAuth';
import { usePlants } from './hooks/usePlants';
import { useCareItems } from './hooks/useCareItems';
import { LoginForm } from './components/Auth/LoginForm';
import { GardenCanvas } from './components/GardenCanvas';
import { GardenSpotModal } from './components/GardenSpotModal';
import { AccountMenu } from './components/AccountMenu';
import { PlantForm } from './components/PlantForm';
import { DueToday } from './components/DueToday';
import { GardenLocationSettings } from './components/GardenLocationSettings';
import { PlantCareModal } from './components/PlantCareModal';
import { weatherService } from './services/weather/forecast';
import {
  userSettingsService,
  type GardenLocation,
} from './services/supabase/userSettings';
import type { Plant, WeatherData } from './types';

export default function App() {
  const { user, loading, checkAuth, logout } = useAuth();
  const { plants, fetchPlants, updatePlant } = usePlants();
  const careItems = useCareItems((s) => s.items);
  const fetchCareItems = useCareItems((s) => s.fetchForUser);
  const refreshFromWeather = useCareItems((s) => s.refreshFromWeather);

  const [showPlantForm, setShowPlantForm] = useState(false);
  const [showLocation, setShowLocation] = useState(false);
  const [garden, setGarden] = useState<GardenLocation | null>(null);
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [selectedPlant, setSelectedPlant] = useState<Plant | null>(null);

  const [selectedLocation, setSelectedLocation] = useState<{
    x: number;
    y: number;
  } | null>(null);

  // Set when a yard click landed near one or more existing plants, so the
  // user can pick one to open or add another on top of it instead of the
  // click silently starting a brand-new plant.
  const [spotPicker, setSpotPicker] = useState<{
    x: number;
    y: number;
    plants: Plant[];
  } | null>(null);

  useEffect(() => {
    checkAuth();
  }, []);

  useEffect(() => {
    if (user?.id) {
      fetchPlants(user.id);
      fetchCareItems(user.id);
    }
  }, [user?.id]);

  // Saved garden location, if the user has set one.
  useEffect(() => {
    if (!user?.id) return;
    userSettingsService
      .getSettings(user.id)
      .then((s) => setGarden(s?.garden ?? null))
      .catch((err) => console.error('Settings unavailable:', err));
  }, [user?.id]);

  // Care generation reads this; without it every plan falls back to baselines.
  // Saved location wins, then VITE_GARDEN_LAT/LON, then the browser prompt.
  useEffect(() => {
    if (!user?.id) return;
    const fetchWeather = garden
      ? weatherService.getWeather(garden.latitude, garden.longitude)
      : weatherService.getWeatherHere();
    fetchWeather
      .then(setWeather)
      .catch((err) => console.error('Weather unavailable:', err));
  }, [user?.id, garden?.latitude, garden?.longitude]);

  // Keep the open care popup in sync if plants refetch underneath it.
  useEffect(() => {
    if (!selectedPlant) return;
    const fresh = plants.find((p) => p.id === selectedPlant.id);
    if (fresh && fresh !== selectedPlant) setSelectedPlant(fresh);
  }, [plants, selectedPlant]);

  // Re-generate every plant's care plan from the current weather snapshot
  // once per user per app-open (not on every render/refetch) so due dates,
  // season, and recent rainfall stay current without nagging Supabase or
  // the weather API on every plant list refresh. Runs as soon as plants
  // and weather are both loaded; guarded by user id so logging out and
  // back in (or switching users) refreshes again.
  const refreshedForUserRef = useRef<string | null>(null);
  useEffect(() => {
    if (!user?.id || !weather || plants.length === 0) return;
    if (refreshedForUserRef.current === user.id) return;
    refreshedForUserRef.current = user.id;
    refreshFromWeather(plants, weather, user.id);
  }, [user?.id, weather, plants, refreshFromWeather]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-green-50 to-blue-50">
        <div className="text-center">
          <div className="mb-4 animate-spin text-6xl">🌱</div>
          <p className="font-semibold text-gray-600">
            Loading your garden...
          </p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <LoginForm onAuthSuccess={() => checkAuth()} />;
  }

  const openPlantFormAt = (x: number, y: number) => {
    setSelectedLocation({ x, y });
    setShowPlantForm(true);
  };

  // A click that landed near existing plant(s) opens the chooser instead of
  // silently starting a new plant on top of them.
  const handleCanvasClick = (x: number, y: number, existing: Plant[]) => {
    if (existing.length > 0) {
      setSpotPicker({ x, y, plants: existing });
      return;
    }
    openPlantFormAt(x, y);
  };

  const closePlantForm = () => {
    setShowPlantForm(false);
    setSelectedLocation(null);
  };

  // Awaited (and left to reject) so GardenCanvas knows whether the drop
  // actually saved, instead of silently reverting with no explanation.
  const handleMovePlant = (plantId: string, x: number, y: number) =>
    updatePlant(plantId, { location: { x, y } });

  return (
    <div className="min-h-screen w-full">
      {user && (
        <DueToday
          userId={user.id}
          plants={plants}
          onOpenPlant={(plantId) =>
            setSelectedPlant(plants.find((p) => p.id === plantId) ?? null)
          }
        />
      )}

      {/* Banner (with the account menu overlaid on it), yard, and plant markers */}
      <GardenCanvas
        plants={plants}
        careItems={careItems}
        yardImageUrl="/default-yard.png"
        onYardClick={handleCanvasClick}
        onSelectPlant={setSelectedPlant}
        onMovePlant={handleMovePlant}
        accountSlot={
          <AccountMenu
            email={user.email}
            locationLabel={garden?.label}
            onSetLocation={() => setShowLocation(true)}
            onLogout={logout}
          />
        }
      />

      {showLocation && (
        <GardenLocationSettings
          userId={user.id}
          current={garden}
          onSaved={setGarden}
          onClose={() => setShowLocation(false)}
        />
      )}

      {spotPicker && (
        <GardenSpotModal
          plants={spotPicker.plants}
          onSelectPlant={(plant) => {
            setSpotPicker(null);
            setSelectedPlant(plant);
          }}
          onAddNew={() => {
            openPlantFormAt(spotPicker.x, spotPicker.y);
            setSpotPicker(null);
          }}
          onClose={() => setSpotPicker(null)}
        />
      )}

      {selectedPlant && (
        <PlantCareModal
          plant={selectedPlant}
          userId={user.id}
          weather={weather}
          onClose={() => setSelectedPlant(null)}
          onPhotoUploaded={() => fetchPlants(user.id)}
        />
      )}

      {/* Add plant modal */}
      {showPlantForm && selectedLocation && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:items-center">
          <div className="flex max-h-[90vh] w-full max-w-md flex-col rounded-lg bg-white shadow-xl">
            <div className="flex shrink-0 items-center justify-between border-b p-4">
              <h3 className="text-lg font-bold">Add Plant</h3>

              <button
                type="button"
                onClick={closePlantForm}
                className="text-xl text-gray-500 hover:text-gray-700"
                aria-label="Close add plant form"
              >
                ✕
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <PlantForm
                location={selectedLocation}
                weather={weather}
                onSuccess={() => {
                  closePlantForm();

                  if (user?.id) {
                    fetchPlants(user.id);
                    fetchCareItems(user.id);
                  }
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
