
# Gradient thermique moyen :
# diminution de 0.0065 °C par metre

GRADIENT = 0.0065

def corriger_temperature(
    temperature_station,
    altitude_station,
    altitude_cible
):
    difference = altitude_cible - altitude_station

    return temperature_station - GRADIENT * difference


temperature = 15.0
altitude_station = 200

for altitude_cible in [200, 800, 1500]:
    resultat = corriger_temperature(
        temperature,
        altitude_station,
        altitude_cible
    )

    print(
        f"Altitude {altitude_cible} m : "
        f"{resultat:.2f} °C"
    )

print("\nTest termine !")
