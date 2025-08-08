FROM golang:1.22-alpine AS build
WORKDIR /src
COPY go.mod .
COPY . .
RUN go build -o /out/api-go .

FROM alpine:3.20
WORKDIR /app
COPY --from=build /out/api-go ./api-go
EXPOSE 8080
CMD ["/app/api-go"]

