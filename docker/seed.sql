-- Dev seed for Panoptic: two databases with enough objects to make the tree realistic.
-- Idempotent: drops and recreates the seed databases.
SET NOCOUNT ON;

IF DB_ID('Orders') IS NOT NULL BEGIN ALTER DATABASE Orders SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE Orders; END
IF DB_ID('Inventory') IS NOT NULL BEGIN ALTER DATABASE Inventory SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE Inventory; END
GO
CREATE DATABASE Orders;
GO
CREATE DATABASE Inventory;
GO

USE Orders;
GO
CREATE SCHEMA sales;
GO
CREATE SCHEMA audit;
GO
CREATE TABLE dbo.Customer (
    CustomerId int IDENTITY PRIMARY KEY,
    TenantId varchar(20) NOT NULL,
    Name nvarchar(200) NOT NULL,
    Email nvarchar(320) NULL,
    CreatedUtc datetime2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT UQ_Customer_Email UNIQUE (TenantId, Email)
);
CREATE TABLE sales.[Order] (
    OrderId bigint IDENTITY PRIMARY KEY,
    CustomerId int NOT NULL CONSTRAINT FK_Order_Customer REFERENCES dbo.Customer (CustomerId),
    Status varchar(20) NOT NULL,
    Total decimal(18, 2) NOT NULL,
    Notes nvarchar(max) NULL,
    PlacedUtc datetime2(3) NOT NULL
);
CREATE INDEX IX_Order_Customer ON sales.[Order] (CustomerId, PlacedUtc DESC);
CREATE TABLE sales.OrderLine (
    OrderId bigint NOT NULL REFERENCES sales.[Order] (OrderId),
    LineNumber int NOT NULL,
    Sku varchar(40) NOT NULL,
    Quantity int NOT NULL,
    UnitPrice decimal(18, 4) NOT NULL,
    LineTotal AS (Quantity * UnitPrice),
    CONSTRAINT PK_OrderLine PRIMARY KEY (OrderId, LineNumber)
);
CREATE TABLE audit.ChangeLog (Id bigint IDENTITY PRIMARY KEY, TableName sysname NOT NULL, ChangedUtc datetime2 NOT NULL, Payload nvarchar(max));
GO
CREATE VIEW sales.OpenOrders AS
    SELECT o.OrderId, c.Name, o.Total, o.PlacedUtc FROM sales.[Order] o JOIN dbo.Customer c ON c.CustomerId = o.CustomerId WHERE o.Status = 'open';
GO
CREATE PROCEDURE sales.GetCustomerOrders @CustomerId int AS
    SELECT * FROM sales.[Order] WHERE CustomerId = @CustomerId ORDER BY PlacedUtc DESC;
GO
CREATE FUNCTION dbo.OrderCount (@CustomerId int) RETURNS int AS
BEGIN
    RETURN (SELECT COUNT(*) FROM sales.[Order] WHERE CustomerId = @CustomerId);
END
GO
CREATE SYNONYM dbo.Orders FOR sales.[Order];
GO
-- Bulk out the catalog so Tables expands like a real database.
DECLARE @i int = 1;
WHILE @i <= 120
BEGIN
    DECLARE @sql nvarchar(max) = CONCAT(
        'CREATE TABLE dbo.Lookup', FORMAT(@i, '000'), ' (Id int PRIMARY KEY, Code varchar(20) NOT NULL, Label nvarchar(100) NULL, SortOrder smallint NOT NULL DEFAULT 0);');
    EXEC (@sql);
    SET @sql = CONCAT('CREATE PROCEDURE dbo.usp_Lookup', FORMAT(@i, '000'), '_Get AS SELECT * FROM dbo.Lookup', FORMAT(@i, '000'), ';');
    EXEC (@sql);
    SET @i += 1;
END
INSERT dbo.Customer (TenantId, Name, Email) VALUES ('t-1', N'Acme Ltd', N'ops@acme.example'), ('t-2', N'Globex', N'it@globex.example');
INSERT sales.[Order] (CustomerId, Status, Total, PlacedUtc) VALUES (1, 'open', 120.50, SYSUTCDATETIME()), (2, 'closed', 9.99, SYSUTCDATETIME());
GO

USE Inventory;
GO
CREATE TABLE dbo.Warehouse (WarehouseId int PRIMARY KEY, Name nvarchar(100) NOT NULL, Region varchar(20) NOT NULL);
CREATE TABLE dbo.Stock (
    WarehouseId int NOT NULL REFERENCES dbo.Warehouse (WarehouseId),
    Sku varchar(40) NOT NULL,
    OnHand int NOT NULL,
    UpdatedUtc datetime2(0) NOT NULL,
    CONSTRAINT PK_Stock PRIMARY KEY (WarehouseId, Sku)
);
GO
CREATE VIEW dbo.LowStock AS SELECT * FROM dbo.Stock WHERE OnHand < 10;
GO
