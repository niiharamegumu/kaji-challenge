package dbtest

import (
	"context"
	"database/sql"
	"errors"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/golang-migrate/migrate/v4"
	"github.com/golang-migrate/migrate/v4/database/postgres"
	_ "github.com/golang-migrate/migrate/v4/source/file"
	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/peterldowns/pgtestdb"
	"github.com/peterldowns/pgtestdb/migrators/common"
)

type testingTB interface {
	Cleanup(func())
	Failed() bool
	Helper()
	Fatalf(format string, args ...any)
	Logf(format string, args ...any)
	Skip(args ...any)
}

// IsolatedDatabaseURL returns a per-test isolated database URL provisioned via pgtestdb.
// It requires TEST_DATABASE_URL to be set to an administrative database endpoint.
func IsolatedDatabaseURL(t testingTB) string {
	t.Helper()
	adminURL := strings.TrimSpace(os.Getenv("TEST_DATABASE_URL"))
	if adminURL == "" {
		t.Skip("TEST_DATABASE_URL is required for router tests")
	}

	parsed, err := url.Parse(adminURL)
	if err != nil {
		t.Fatalf("failed to parse TEST_DATABASE_URL: %v", err)
	}
	pass, _ := parsed.User.Password()
	port := parsed.Port()
	if port == "" {
		port = "5432"
	}

	conf := pgtestdb.Config{
		DriverName: "pgx",
		Host:       parsed.Hostname(),
		Port:       port,
		User:       parsed.User.Username(),
		Password:   pass,
		Database:   strings.TrimPrefix(parsed.Path, "/"),
		Options:    parsed.RawQuery,
		// Router tests keep pool connections alive until process end.
		ForceTerminateConnections: true,
	}

	migrator := fileMigrator{dir: migrationsDir(t)}
	isolated := pgtestdb.Custom(t, conf, migrator)
	return isolated.URL()
}

func migrationsDir(t testingTB) string {
	t.Helper()
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatalf("failed to resolve test file path")
	}
	return filepath.Join(filepath.Dir(file), "..", "..", "..", "migrations")
}

type fileMigrator struct {
	dir string
}

func (m fileMigrator) Hash() (string, error) {
	return common.HashDir(m.dir)
}

func (m fileMigrator) Migrate(_ context.Context, db *sql.DB, _ pgtestdb.Config) error {
	driver, err := postgres.WithInstance(db, &postgres.Config{})
	if err != nil {
		return err
	}
	mg, err := migrate.NewWithDatabaseInstance("file://"+m.dir, "postgres", driver)
	if err != nil {
		return err
	}
	defer func() {
		_, _ = mg.Close()
	}()
	if err := mg.Up(); err != nil && !errors.Is(err, migrate.ErrNoChange) {
		return err
	}
	return nil
}
