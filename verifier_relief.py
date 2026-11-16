
import rasterio
from rasterio.enums import Resampling

url = (
    "/vsicurl/https://copernicus-dem-30m.s3.amazonaws.com/"
    "Copernicus_DSM_COG_10_N48_00_E002_00_DEM/"
    "Copernicus_DSM_COG_10_N48_00_E002_00_DEM.tif"
)

with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR"):
    with rasterio.open(url) as r:

        relief = r.read(
            1,
            out_shape=(100, 100),
            resampling=Resampling.average,
            masked=True
        )

        print("Dimensions originales :", r.width, "x", r.height)
        print("Dimensions reduites :", relief.shape)
        print("Altitude minimale :", round(float(relief.min()), 1), "m")
        print("Altitude maximale :", round(float(relief.max()), 1), "m")

print("Lecture simplifiee reussie !")
