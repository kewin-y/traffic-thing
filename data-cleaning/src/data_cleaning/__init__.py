import pandas as pd 
from sklearn.preprocessing import MinMaxScaler

def main() -> None:

    df = pd.read_csv("C:/Users/kaise/OneDrive/Desktop/data/street_lanes_volume_twoway (1).csv")
    df = df.dropna(axis='index',
                how='all',
                subset=['volume_vehicle_daily_per_dir_est'])

    # min-max normalisation
    scaler = MinMaxScaler()
    df['traffic_scale'] = scaler.fit_transform(df[['volume_vehicle_daily_per_dir_est']])