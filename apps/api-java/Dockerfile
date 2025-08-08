FROM maven:3.9-eclipse-temurin-17 AS build
WORKDIR /src
COPY pom.xml .
RUN mvn -q -DskipTests package || true
COPY src ./src
RUN mvn -q -DskipTests package || true

FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /src/target/api-java-0.1.0.jar ./app.jar
EXPOSE 8081
CMD ["java", "-jar", "app.jar"]

