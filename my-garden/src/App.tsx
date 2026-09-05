import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from './hooks/useAuth';
import { usePlants } from './hooks/usePlants';
import { useCareItems } from './hooks/useCareItems';
import { useEntitlement, useIsPremium, FREE_PLANT_LIMIT } from './hooks/useEntitlement';
import { LoginForm } from './components/Auth/LoginForm';
import { ResetPasswordForm } from './components/Auth/ResetPasswordForm';
import { UpdatePrompt } from './components/UpdatePrompt';
import { GardenCanvas } from './components/GardenCanvas';
import { GardenSpotModal } from './components/GardenSpotModal';
import { AccountMenu } from './components/AccountMenu';
import { PlantForm } from './components/PlantForm';
import { DueToday } from './components/DueToday';
import { RainStatus } from './components/RainStatus';
import { YardsSettings } from './components/YardsSettings';
import { ProfileSettings } from './components/ProfileSettings';
import { PricingModal } from './components/PricingModal';
import { PlantCareModal } from './components/PlantCareModal';
import { YardObstaclesSettings } from './components/YardObstaclesSettings';
import { SunMapOverlay } from './components/SunMapOverlay';
import { GrantAccessModal } from './components/GrantAccessModal';
import { weatherService } from './services/weather/forecast';
import { getSeasonalRainWindDirections } from './services/weather/climateWind';
import type { Season } from './utils/sunExposure';
import { billingService } from './services/supabase/billing';
import { yardObstaclesService } from './services/supabase/yardObstacles';
import { yardsService } from './services/supabase/yards';
import { yardSectionsService } from './services/supabase/yardSections';
import { userSettingsService, type Profile } from './services/supabase/userSettings';
import type { Box } from './utils/sectionView';
import type { CareItem, Plant, WeatherData, Yard, YardObstacle, YardSection } from './types';

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
  const [showYards, setShowYards] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showObstacles, setShowObstacles] = useState(false);
  const [showSunMap, setShowSunMap] = useState(false);
  const [showGrantAccess, setShowGrantAccess] = useState(false);
  const [pricingReason, setPricingReason] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile>({});
  const [yards, setYards] = useState<Yard[]>([]);
  const [yardsLoading, setYardsLoading] = useState(true);
  const [activeYardId, setActiveYardId] = useState<string | null>(null);
  const [sections, setSections] = useState<YardSection[]>([]);
  const [obstacles, setObstacles] = useState<YardObstacle[]>([]);
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [seasonalRainWind, setSeasonalRainWind] = useState<Record<Season, number | null> | null>(null);
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

  const activeYard = useMemo(() => yards.find((y) => y.id === activeYardId) ?? null, [yards, activeYardId]);
  // Every plant/obstacle is scoped to one yard — its location only makes
  // sense relative to that yard's own photo. Fetched once for the whole
  // account, filtered client-side so switching yards is instant.
  const activeYardPlants = useMemo(
    () => plants.filter((p) => p.yardId === activeYardId),
    [plants, activeYardId],
  );
  const activeYardObstacles = useMemo(
    () => obstacles.filter((o) => o.yardId === activeYardId),
    [obstacles, activeYardId],
  );

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

  // Every yard on the account, plus profile (display name/icon) and which
  // yard opens by default. A brand-new account (or one that somehow lost
  // its migration-backfilled yard) gets one created lazily rather than
  // showing a broken/empty state.
  useEffect(() => {
    if (!user?.id) return;
    Promise.all([yardsService.getForUser(user.id), userSettingsService.getSettings(user.id)])
      .then(async ([fetchedYards, settings]) => {
        setProfile(settings?.profile ?? {});
        let list = fetchedYards;
        if (list.length === 0) {
          const created = await yardsService.create(user.id, {});
          list = [created];
        }
        setYards(list);
        const defaultId = settings?.defaultYardId;
        setActiveYardId(list.find((y) => y.id === defaultId)?.id ?? list[0].id);
      })
      .catch((err) => console.error('Yards/settings unavailable:', err))
      .finally(() => setYardsLoading(false));
  }, [user?.id]);

  // That yard's saved zoom sections (see utils/sectionView.ts).
  useEffect(() => {
    if (!activeYardId) return;
    yardSectionsService
      .getForYard(activeYardId)
      .then(setSections)
      .catch((err) => console.error('Yard sections unavailable:', err));
  }, [activeYardId]);

  // Care generation reads this; without it every plan falls back to
  // baselines. Only the *active* yard's weather is fetched — switching
  // yards re-fetches for wherever you switch to, rather than eagerly
  // fetching every yard's weather up front. The active yard's own saved
  // location wins, then VITE_GARDEN_LAT/LON, then the browser prompt.
  useEffect(() => {
    if (!user?.id || !activeYard) return;
    const fetchWeather =
      activeYard.latitude != null && activeYard.longitude != null
        ? weatherService.getWeather(activeYard.latitude, activeYard.longitude)
        : weatherService.getWeatherHere();
    fetchWeather
      .then(setWeather)
      .catch((err) => console.error('Weather unavailable:', err));
  }, [user?.id, activeYard?.id, activeYard?.latitude, activeYard?.longitude]);

  // The real prevailing rain-wind direction per season at this yard's
  // location (see services/weather/climateWind.ts) — powers the
  // best-placement suggestion's year-round rain reasoning. Best-effort:
  // failing to load it just falls back to a direction-agnostic rain check.
  useEffect(() => {
    setSeasonalRainWind(null);
    if (activeYard?.latitude == null || activeYard?.longitude == null) return;
    let cancelled = false;
    getSeasonalRainWindDirections(activeYard.latitude, activeYard.longitude)
      .then((result) => {
        if (!cancelled) setSeasonalRainWind(result);
      })
      .catch((err) => console.error('Seasonal rain-wind climatology unavailable:', err));
    return () => {
      cancelled = true;
    };
  }, [activeYard?.latitude, activeYard?.longitude]);

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

  // Re-generate the active yard's plants' care plans from its current
  // weather snapshot once per yard per app-open (not on every render/
  // refetch) so due dates, season, and recent rainfall stay current
  // without nagging Supabase or the weather API on every refresh. Runs as
  // soon as that yard's plants and weather are both loaded; keyed by yard
  // id (not just user id) so switching to a yard that hasn't been visited
  // yet this session refreshes it too, instead of only ever the first one.
  const refreshedYardIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!user?.id || !activeYard || !weather || activeYardPlants.length === 0) return;
    if (refreshedYardIdsRef.current.has(activeYard.id)) return;
    refreshedYardIdsRef.current.add(activeYard.id);
    refreshFromWeather(activeYardPlants, weather, user.id, activeYardObstacles, activeYard);
  }, [user?.id, activeYard, weather, activeYardPlants, activeYardObstacles, refreshFromWeather]);

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

  // Every plant/obstacle location only makes sense relative to a specific
  // yard, so the map (and Add Plant) must not be reachable until that
  // yard has actually loaded — on a slow connection, rendering the map
  // early let taps land before `activeYard` existed, failing to save with
  // "No active yard to add this plant to" at submit time.
  if (yardsLoading) {
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

  const handleCreateSection = async (box: Box, name: string) => {
    if (!activeYard) return;
    const created = await yardSectionsService.create(activeYard.id, {
      name,
      boxX0: box.x0,
      boxY0: box.y0,
      boxX1: box.x1,
      boxY1: box.y1,
    });
    setSections((prev) => [...prev, created]);
  };

  return (
    <div className="min-h-screen w-full">
      <UpdatePrompt />
      {/* Banner (with the account menu overlaid on it), Due Today, the yard, and plant markers */}
      <GardenCanvas
        plants={activeYardPlants}
        careItems={careItems}
        kindFilter={kindFilter}
        yardImageUrl={activeYard?.imageUrl ?? '/default-yard.png'}
        sections={sections}
        onCreateSection={handleCreateSection}
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
              plants={activeYardPlants}
              obstacles={activeYardObstacles}
              garden={activeYard}
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
            activeYardName={activeYard?.name}
            plan={entitlement.plan}
            onShowYards={() => setShowYards(true)}
            onEditProfile={() => setShowProfile(true)}
            onEditObstacles={() => setShowObstacles(true)}
            onShowSunMap={() => setShowSunMap(true)}
            onBilling={openBilling}
            onGrantAccess={() => setShowGrantAccess(true)}
            onLogout={logout}
          />
        }
      />

      {showYards && (
        <YardsSettings
          userId={user.id}
          yards={yards}
          activeYardId={activeYardId}
          onSaved={setYards}
          onSwitch={(yardId) => {
            setActiveYardId(yardId);
            userSettingsService.setDefaultYard(user.id, yardId).catch((err) =>
              console.error('Could not save default yard:', err),
            );
          }}
          onClose={() => setShowYards(false)}
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

      {showObstacles && activeYard && (
        <YardObstaclesSettings
          userId={user.id}
          yardId={activeYard.id}
          yardImageUrl={activeYard.imageUrl}
          obstacles={activeYardObstacles}
          sections={sections}
          onSaved={(updated) =>
            setObstacles((prev) => [...prev.filter((o) => o.yardId !== activeYard.id), ...updated])
          }
          onClose={() => setShowObstacles(false)}
        />
      )}

      {showSunMap && (
        <SunMapOverlay
          yardImageUrl={activeYard?.imageUrl ?? '/default-yard.png'}
          obstacles={activeYardObstacles}
          garden={activeYard}
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
          garden={activeYard}
          obstacles={activeYardObstacles}
          seasonalRainWind={seasonalRainWind}
          onClose={() => setSelectedPlant(null)}
          onPhotoUploaded={() => fetchPlants(user.id)}
          onDeletePlant={deletePlant}
          onMovePlant={handleMovePlant}
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
                obstacles={activeYardObstacles}
                garden={activeYard}
                seasonalRainWind={seasonalRainWind}
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
                obstacles={activeYardObstacles}
                garden={activeYard}
                seasonalRainWind={seasonalRainWind}
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
