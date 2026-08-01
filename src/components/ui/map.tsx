"use client";

import { Icon } from "@iconify/react";
import type * as GeoJSON from "geojson";
import * as maplibregl from "maplibre-gl";
import type {
  FillLayerSpecification,
  GeoJSONSource,
  LineLayerSpecification,
  MapOptions,
  MarkerOptions,
  PopupOptions,
  StyleSpecification,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  createContext,
  createElement,
  forwardRef,
  useContext,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type MutableRefObject,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";

type MapStyleOption = string | StyleSpecification;
export type MapRef = maplibregl.Map;

type MapContextValue = {
  map: maplibregl.Map | null;
  isLoaded: boolean;
  activePopupMarkerRef: MutableRefObject<maplibregl.Marker | null>;
};

const MapContext = createContext<MapContextValue | null>(null);

export function useMap() {
  const context = useContext(MapContext);
  if (!context) throw new Error("useMap must be used within Map");
  return context;
}

export type MapProps = Omit<MapOptions, "container" | "style"> & {
  children?: ReactNode;
  className?: string;
  styles: { light: MapStyleOption; dark?: MapStyleOption };
  theme?: "light" | "dark";
  ariaLabel?: string;
};

/**
 * Project-owned MapCN map primitive. It follows MapCN's copy-and-own model,
 * while keeping this app's existing OSM style and MapLibre version.
 */
export const Map = forwardRef<MapRef, MapProps>(function Map(
  {
    children,
    className,
    styles,
    theme = "light",
    ariaLabel = "Interactive map",
    ...options
  },
  forwardedRef,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const initialOptionsRef = useRef(options);
  const initialStyleRef = useRef(
    theme === "dark" && styles.dark ? styles.dark : styles.light,
  );
  const [map, setMap] = useState<maplibregl.Map | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const activePopupMarkerRef = useRef<maplibregl.Marker | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const instance = new maplibregl.Map({
      ...initialOptionsRef.current,
      container: containerRef.current,
      style: initialStyleRef.current,
      renderWorldCopies: false,
    });
    const handleLoad = () => setIsLoaded(true);
    instance.on("load", handleLoad);
    const observer = new ResizeObserver(() => instance.resize());
    observer.observe(containerRef.current);
    setMap(instance);

    return () => {
      observer.disconnect();
      instance.off("load", handleLoad);
      instance.remove();
      setMap(null);
      setIsLoaded(false);
    };
  }, []);

  useImperativeHandle(forwardedRef, () => map as MapRef, [map]);

  const context = useMemo(
    () => ({ map, isLoaded, activePopupMarkerRef }),
    [isLoaded, map],
  );

  return (
    <MapContext.Provider value={context}>
      <div
        ref={containerRef}
        className={cn("mapcn-map", className)}
        role="region"
        aria-label={ariaLabel}
        tabIndex={0}
      >
        {!isLoaded && (
          <div className="mapcn-map__loader" role="status">
            <span />
            <span />
            <span />
          </div>
        )}
        {isLoaded && children}
      </div>
    </MapContext.Provider>
  );
});

type MarkerContextValue = {
  marker: maplibregl.Marker;
  map: maplibregl.Map;
};

const MarkerContext = createContext<MarkerContextValue | null>(null);

function useMarker() {
  const context = useContext(MarkerContext);
  if (!context) throw new Error("Marker content must be used within MapMarker");
  return context;
}

export type MapMarkerProps = Omit<MarkerOptions, "element"> & {
  longitude: number;
  latitude: number;
  children: ReactNode;
  onClick?: () => void;
};

export function MapMarker({
  longitude,
  latitude,
  children,
  onClick,
  draggable = false,
  ...options
}: MapMarkerProps) {
  const { map, activePopupMarkerRef } = useMap();
  const onClickRef = useRef(onClick);
  useEffect(() => {
    onClickRef.current = onClick;
  }, [onClick]);
  const root = useMemo(() => {
    const element = document.createElement("div");
    element.className = "mapcn-marker-root";
    return element;
  }, []);
  const marker = useMemo(
    () =>
      new maplibregl.Marker({
        ...options,
        draggable,
        element: root,
      }).setLngLat([longitude, latitude]),
    // Marker construction options are intentionally initial-only. Dynamic
    // geographic values are synchronized below without rebuilding the marker.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useEffect(() => {
    if (!map) return;
    marker.addTo(map);
    const handleClick = (event: MouseEvent) => {
      event.stopPropagation();
      const popup = marker.getPopup();
      if (popup) {
        const activeMarker = activePopupMarkerRef.current;
        if (
          activeMarker &&
          activeMarker !== marker &&
          activeMarker.getPopup()?.isOpen()
        ) {
          activeMarker.togglePopup();
        }
        marker.togglePopup();
        activePopupMarkerRef.current = popup.isOpen() ? marker : null;
      }
      onClickRef.current?.();
    };
    root.addEventListener("click", handleClick);
    return () => {
      root.removeEventListener("click", handleClick);
      if (activePopupMarkerRef.current === marker) {
        activePopupMarkerRef.current = null;
      }
      marker.remove();
    };
  }, [activePopupMarkerRef, map, marker, root]);

  useEffect(() => {
    marker.setLngLat([longitude, latitude]);
  }, [latitude, longitude, marker]);

  if (!map) return null;

  return (
    <MarkerContext.Provider value={{ marker, map }}>
      {children}
    </MarkerContext.Provider>
  );
}

export function MarkerContent({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const { marker } = useMarker();
  return createPortal(
    <div className={cn("mapcn-marker-content", className)}>{children}</div>,
    marker.getElement(),
  );
}

export type MarkerPopupProps = Omit<
  PopupOptions,
  "className" | "closeButton"
> & {
  children: ReactNode;
  className?: string;
  closeButton?: boolean;
};

export function MarkerPopup({
  children,
  className,
  closeButton = false,
  offset = 18,
  maxWidth = "none",
  ...options
}: MarkerPopupProps) {
  const { marker, map } = useMarker();
  const container = useMemo(() => document.createElement("div"), []);
  const popup = useMemo(
    () =>
      new maplibregl.Popup({
        ...options,
        closeButton: false,
        offset,
        maxWidth,
      }).setDOMContent(container),
    // Popup construction options are synchronized only when the component is
    // remounted, matching MapCN's marker-popup composition model.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useEffect(() => {
    popup.setDOMContent(container);
    marker.setPopup(popup);
    return () => {
      marker.setPopup(null);
      popup.remove();
    };
  }, [container, map, marker, popup]);

  return createPortal(
    <div className={cn("mapcn-popup", className)}>
      {closeButton && (
        <button
          type="button"
          className="mapcn-popup__close"
          onClick={() => popup.remove()}
          aria-label="关闭地图信息"
        >
          <Icon icon="solar:close-circle-bold" />
        </button>
      )}
      {children}
    </div>,
    container,
  );
}

export function MapOverlay({
  position = "top-left",
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  position?: "top-left" | "top-right" | "bottom-left" | "bottom-right";
}) {
  return (
    <div
      className={cn("mapcn-overlay", `mapcn-overlay--${position}`, className)}
      {...props}
    >
      {children}
    </div>
  );
}

export function MapControls({
  position = "bottom-right",
  showZoom = true,
  showCompass = true,
  showLocate = false,
}: {
  position?: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  showZoom?: boolean;
  showCompass?: boolean;
  showLocate?: boolean;
}) {
  const { map } = useMap();
  if (!map) return null;
  const locate = () => {
    navigator.geolocation?.getCurrentPosition((positionValue) => {
      map.easeTo({
        center: [
          positionValue.coords.longitude,
          positionValue.coords.latitude,
        ],
        zoom: Math.max(map.getZoom(), 15),
        duration: 500,
      });
    });
  };

  return (
    <MapOverlay position={position} className="mapcn-controls">
      {showLocate && (
        <button type="button" onClick={locate} aria-label="定位到当前位置">
          <Icon icon="solar:map-point-bold-duotone" />
        </button>
      )}
      {showCompass && (
        <button
          type="button"
          onClick={() => map.easeTo({ bearing: 0, pitch: 0, duration: 300 })}
          aria-label="地图朝北"
        >
          <Icon icon="solar:compass-big-bold-duotone" />
        </button>
      )}
      {showZoom && (
        <>
          <button
            type="button"
            onClick={() => map.zoomIn({ duration: 200 })}
            aria-label="放大地图"
          >
            <Icon icon="solar:add-circle-bold" />
          </button>
          <button
            type="button"
            onClick={() => map.zoomOut({ duration: 200 })}
            aria-label="缩小地图"
          >
            <Icon icon="solar:minus-circle-bold" />
          </button>
        </>
      )}
    </MapOverlay>
  );
}

export type MapGeoJSONProps = {
  id: string;
  data: GeoJSON.GeoJSON;
  fillPaint?: FillLayerSpecification["paint"] | false;
  linePaint?: LineLayerSpecification["paint"] | false;
  lineLayout?: LineLayerSpecification["layout"];
  beforeId?: string;
};

export function MapGeoJSON({
  id,
  data,
  fillPaint,
  linePaint,
  lineLayout,
  beforeId,
}: MapGeoJSONProps) {
  const { map, isLoaded } = useMap();
  const sourceId = `${id}-source`;
  const fillId = `${id}-fill`;
  const lineId = `${id}-line`;
  const initialDataRef = useRef(data);

  useEffect(() => {
    if (!map || !isLoaded || map.getSource(sourceId)) return;
    const resolvedBeforeId =
      beforeId && map.getLayer(beforeId) ? beforeId : undefined;
    map.addSource(sourceId, {
      type: "geojson",
      data: initialDataRef.current,
    });
    if (fillPaint !== false) {
      map.addLayer(
        {
          id: fillId,
          type: "fill",
          source: sourceId,
          paint: fillPaint ?? {
            "fill-color": "#2563eb",
            "fill-opacity": 0.18,
          },
        },
        resolvedBeforeId,
      );
    }
    if (linePaint !== false) {
      map.addLayer(
        {
          id: lineId,
          type: "line",
          source: sourceId,
          paint: linePaint ?? {
            "line-color": "#2563eb",
            "line-width": 2,
            "line-opacity": 0.9,
          },
          layout: lineLayout ?? {
            "line-cap": "round",
            "line-join": "round",
          },
        },
        resolvedBeforeId,
      );
    }
    return () => {
      try {
        if (map.getLayer(lineId)) map.removeLayer(lineId);
        if (map.getLayer(fillId)) map.removeLayer(fillId);
        if (map.getSource(sourceId)) map.removeSource(sourceId);
      } catch {
        // The owning Map can already be disposed during a route transition.
      }
    };
  }, [beforeId, fillId, fillPaint, id, isLoaded, lineId, lineLayout, linePaint, map, sourceId]);

  useEffect(() => {
    try {
      const source = map?.getSource(sourceId) as GeoJSONSource | undefined;
      source?.setData(data);
    } catch {
      // Ignore a final data update racing with map disposal.
    }
  }, [data, map, sourceId]);

  return null;
}

export function MapRoute({
  id,
  coordinates,
  color = "#2563eb",
  width = 3,
  opacity = 0.9,
}: {
  id: string;
  coordinates: [number, number][];
  color?: string;
  width?: number;
  opacity?: number;
}) {
  const data = useMemo<GeoJSON.Feature<GeoJSON.LineString>>(
    () => ({
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates },
    }),
    [coordinates],
  );
  return (
    <MapGeoJSON
      id={id}
      data={data}
      fillPaint={false}
      linePaint={{
        "line-color": color,
        "line-width": width,
        "line-opacity": opacity,
      }}
    />
  );
}

export function MarkerLabel({
  children,
  position = "top",
  style,
  className,
}: {
  children: ReactNode;
  position?: "top" | "bottom";
  style?: CSSProperties;
  className?: string;
}) {
  return createElement(
    "span",
    {
      className: cn(
        "mapcn-marker-label",
        `mapcn-marker-label--${position}`,
        className,
      ),
      style,
    },
    children,
  );
}
