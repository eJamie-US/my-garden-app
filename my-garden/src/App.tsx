import { useEffect, useRef, useState } from 'react';
import { useAuth } from './hooks/useAuth';
import { usePlants } from './hooks/usePlants';
import { useCareItems } from './hooks/useCareItems';
import { useEntitlement, useIsPremium, FREE_PLANT_LIMIT } from './hooks/useEntitlement';
import { LoginForm } from './components/Auth/LoginForm';
import { ResetPasswordForm } from './components/Auth/ResetPasswordForm';
import { GardenCanvas } from './components/GardenCanvas';
import { GardenSpotModal } from './components/GardenSpotModal';
import { AccountMenu } from './components/AccountMenu';
import { PlantForm } from './components/PlantForm';
import { DueToday } from './components/DueToday';
import { RainStatus } from './components/RainStatus';
import { GardenLocationSettings } from './components/GardenLocationSettings';
import { ProfileSettings } from './components/ProfileSettings';
import { PricingModal } from './components/PricingModal';
import { PlantCareModal } from './components/PlantCareModal';
import { YardObstaclesSettings } from './components/YardObstaclesSettings';
import { SunMapOverlay } from './components/SunMapOverlay';
import { GrantAccessModal } from './components/GrantAccessModal';
import { weatherService } from './services/weather/forecast';
import { billingService } from './services/supabase/billing';
import { yardObstaclesService } from './services/supabase/yardObstacles';
import {
  userSettingsService,
  type GardenLocation,
  type Profile,
} from './services/supabase/userSettings';
import type { CareItem, Plant, WeatherData, YardObstacle } from './types';

export default function App() {
  const { user, loading, checkAuth, logout, passwordRecovery, listenForPasswordRecovery } = useAuth();
  const { plants, fetchPlants, updatePlant, deletePlant } = usePlants();
  const careItems = useCareItems((s) => s.items);
  const fetchCareItems = useCareItems((s) => s.fetchForUser);
  const refreshFromWeather = useCareItems((s) => s.refreshFromWeather);
  const entitlement = useEntitlement((s) => s.entitlement);
  const fetchEntitlement = useEntitlement((s) => s.fetchForUser);
  const isPremium = useIsPremium();

  const [showPlantForm, setShowPlantForm] = useState(false);
  const [showLocation, setShowLocation] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showObstacles, setShowObstacles] = useState(false);
  const [showSunMap, setShowSunMap] = useState(false);
  const [showGrantAccess, setShowGrantAccess] = useState(false);
  const [pricingReason, setPricingReason] = useState<string | null>(null);
  const [garden, setGarden] = useState<GardenLocation | null>(null);
  const [profile, setProfile] = useState<Profile>({});
  const [obstacles, setObstacles] = useState<YardObstacle[]>([]);
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [selectedPlant, setSelectedPlant] = useState<Plant | null>(null);
  const [editingPlant, setEditingPlant] = useState<Plant | null>(null);
  // Shared between Due Today and the yard map so picking "Water" narrows
  // both the list and the badges at once, not just one of them.
  const [kindFilter, setKindFilter] = useState<Set<CareItem['kind']>>(new Set());

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
    return listenForPasswordRecovery();
  }, []);

  useEffect(() => {
    if (user?.id) {
      fetchPlants(user.id);
      fetchCareItems(user.id);
      fetchEntitlement(user.id);
      yardObstaclesService
        .getForUser(user.id)
        .then(setObstacles)
        .catch((err) => console.error('Yard obstacles unavailable:', err));
    }
  }, [user?.id]);

  // Saved garden location + profile (display name/icon), if the user has set them.
  useEffect(() => {
    if (!user?.id) return;
    userSettingsService
      .getSettings(user.id)
      .then((s) => {
        setGarden(s?.garden ?? null);
        setProfile(s?.profile ?? {});
      })
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

  // Coming back from Stripe Checkout: the webhook that actually grants the
  // plan can lag a second or two behind the redirect, so refetch once now
  // and once shortly after, then drop the query param either way.
  useEffect(() => {
    if (!user?.id) return;
    const params = new URLSearchParams(window.location.search);
    if (!params.has('checkout')) return;
    fetchEntitlement(user.id);
    const retry = setTimeout(() => fetchEntitlement(user.id), 3000);
    window.history.replaceState({}, '', window.location.pathname);
    return () => clearTimeout(retry);
  }, [user?.id]);

  // Keep the open care popup in sync if plants refetch underneath it.
  useEffect(() => {
    if (!selectedPlant) return;
    const fresh = plants.find((p) => p.id === selectedPlant.id);
    if (fresh && fresh !== selectedPlant) setSelectedPlant(fresh);
  }, [plants, selectedPlant]);

  // Same, for the plant-details edit form.
  useEffect(() => {
    if (!editingPlant) return;
    const fresh = plants.find((p) => p.id === editingPlant.id);
    if (fresh && fresh !== editingPlant) setEditingPlant(fresh);
  }, [plants, editingPlant]);

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
    refreshFromWeather(plants, weather, user.id, obstacles, garden);
  }, [user?.id, weather, plants, refreshFromWeather, obstacles, garden]);

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

  if (passwordRecovery) {
    return <ResetPasswordForm />;
  }

  if (!user) {
    return <LoginForm onAuthSuccess={() => checkAuth()} />;
  }

  const openPlantFormAt = (x: number, y: number) => {
    if (!isPremium && plants.length >= FREE_PLANT_LIMIT) {
      setPricingReason(
        `The free plan is limited to ${FREE_PLANT_LIMIT} plants — upgrade for unlimited plants.`,
      );
      return;
    }
    setSelectedLocation({ x, y });
    setShowPlantForm(true);
  };

  const openBilling = async () => {
    if (isPremium) {
      try {
        await billingService.openPortal();
      } catch (err) {
        // No dedicated error UI for this one — it's a redirect, not a form;
        // console is enough for a "billing isn't configured yet" hiccup.
        console.error('Could not open billing portal:', err);
      }
      return;
    }
    setPricingReason('');
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
      {/* Banner (with the account menu overlaid on it), Due Today, the yard, and plant markers */}
      <GardenCanvas
        plants={plants}
        careItems={careItems}
        kindFilter={kindFilter}
        yardImageUrl="/default-yard.png"
        onYardClick={handleCanvasClick}
        onSelectPlant={setSelectedPlant}
        onMovePlant={handleMovePlant}
        belowBanner={
          <>
            <DueToday
              userId={user.id}
              plants={plants}
              onOpenPlant={(plantId) =>
                setSelectedPlant(plants.find((p) => p.id === plantId) ?? null)
              }
              kindFilter={kindFilter}
              onKindFilterChange={setKindFilter}
            />
            <RainStatus
              plants={plants}
              obstacles={obstacles}
              garden={garden}
              weather={weather}
              onOpenPlant={(plantId) =>
                setSelectedPlant(plants.find((p) => p.id === plantId) ?? null)
              }
            />
          </>
        }
        accountSlot={
          <AccountMenu
            email={user.email}
            displayName={profile.displayName}
            avatarIcon={profile.avatarIcon}
            locationLabel={garden?.label}
            plan={entitlement.plan}
            onSetLocation={() => setShowLocation(true)}
            onEditProfile={() => setShowProfile(true)}
            onEditObstacles={() => setShowObstacles(true)}
            onShowSunMap={() => setShowSunMap(true)}
            onBilling={openBilling}
            onGrantAccess={() => setShowGrantAccess(true)}
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

      {showProfile && (
        <ProfileSettings
          userId={user.id}
          current={profile}
          fallbackInitial={user.email.trim().charAt(0).toUpperCase() || '?'}
          onSaved={setProfile}
          onClose={() => setShowProfile(false)}
        />
      )}

      {showObstacles && (
        <YardObstaclesSettings
          userId={user.id}
          yardImageUrl="/default-yard.png"
          obstacles={obstacles}
          onSaved={setObstacles}
          onClose={() => setShowObstacles(false)}
        />
      )}

      {showSunMap && (
        <SunMapOverlay
          yardImageUrl="/default-yard.png"
          obstacles={obstacles}
          garden={garden}
          onClose={() => setShowSunMap(false)}
        />
      )}

      {showGrantAccess && <GrantAccessModal onClose={() => setShowGrantAccess(false)} />}

      {pricingReason !== null && (
        <PricingModal reason={pricingReason || undefined} onClose={() => setPricingReason(null)} />
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
          garden={garden}
          obstacles={obstacles}
          onClose={() => setSelectedPlant(null)}
          onPhotoUploaded={() => fetchPlants(user.id)}
          onDeletePlant={deletePlant}
          onEditDetails={(p) => {
            setSelectedPlant(null);
            setEditingPlant(p);
          }}
        />
      )}

      {/* Edit plant details modal — same form as Add Plant, in its edit mode. */}
      {editingPlant && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:items-center">
          <div className="flex max-h-[90vh] w-full max-w-md flex-col rounded-lg bg-white shadow-xl">
            <div className="flex shrink-0 items-center justify-between border-b p-4">
              <h3 className="text-lg font-bold">Edit {editingPlant.name}</h3>

              <button
                type="button"
                onClick={() => setEditingPlant(null)}
                className="text-xl text-gray-500 hover:text-gray-700"
                aria-label="Close edit plant form"
              >
                ✕
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <PlantForm
                plant={editingPlant}
                location={editingPlant.location}
                existingCareItems={careItems.filter((i) => i.plantId === editingPlant.id)}
                weather={weather}
                obstacles={obstacles}
                garden={garden}
                onSuccess={() => {
                  setEditingPlant(null);
                  fetchPlants(user.id);
                  fetchCareItems(user.id);
                }}
              />
            </div>
          </div>
        </div>
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
                obstacles={obstacles}
                garden={garden}
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
