#include <Arduino.h>

// Define the pin connections
const int trigPin = 13;
const int echoPin = 12;

// Variables to store the duration and calculated distance
long duration;
float distance;

void setup() {
  pinMode(trigPin, OUTPUT); // Sets the trigPin as an Output
  pinMode(echoPin, INPUT);  // Sets the echoPin as an Input
  
  Serial.begin(9600);       // Starts serial communication for the Serial Monitor
}

void loop() {
  // 1. Clear the trigPin by setting it LOW for 2 microseconds
  digitalWrite(trigPin, LOW);
  delayMicroseconds(2);

  // 2. Trigger the sensor by setting the trigPin HIGH for 10 microseconds
  digitalWrite(trigPin, HIGH);
  delayMicroseconds(10);
  digitalWrite(trigPin, LOW);

  // 3. Read the echoPin. pulseIn() returns the time in microseconds 
  // that the sound wave took to travel out and bounce back.
  duration = pulseIn(echoPin, HIGH);

  // 4. Calculate the distance in centimeters
  // The speed of sound is roughly 0.034 cm/microsecond.
  // We divide by 2 because the sound wave travels out AND back.
  distance = duration * 0.034 / 2;

  // 5. Print the result to the Serial Monitor
  Serial.print("Distance: ");
  Serial.print(distance);
  Serial.println(" cm");

  // Wait half a second before taking the next reading
  delay(500); 
}