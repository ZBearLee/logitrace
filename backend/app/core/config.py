"""集中配置：所有环境变量经此读取，代码里不出现裸 os.getenv。"""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    # 应用
    app_name: str = "LogiTrace"
    debug: bool = False

    # MySQL（与 deploy/docker-compose.yml 保持一致）
    mysql_host: str = "localhost"
    mysql_port: int = 3306
    mysql_user: str = "logitrace"
    mysql_password: str = "logitrace"
    mysql_database: str = "logitrace"

    @property
    def mysql_dsn(self) -> str:
        """SQLAlchemy 异步连接串（应用运行时用，驱动 aiomysql）。"""
        return (
            f"mysql+aiomysql://{self.mysql_user}:{self.mysql_password}"
            f"@{self.mysql_host}:{self.mysql_port}/{self.mysql_database}"
        )

    @property
    def mysql_dsn_sync(self) -> str:
        """SQLAlchemy 同步连接串（Alembic迁移 / 脚本等同步场景用，驱动 pymysql）。

        迁移是启动时一次性 DDL，不需要异步；Alembic 官方模板也是同步引擎。
        pymysql 是纯 Python 驱动，免编译，适合本地和 CI。
        """
        return (
            f"mysql+pymysql://{self.mysql_user}:{self.mysql_password}"
            f"@{self.mysql_host}:{self.mysql_port}/{self.mysql_database}"
        )

    # Redis
    redis_host: str = "localhost"
    redis_port: int = 6379
    redis_db: int = 0

    # AI（通用命名，零厂商字眼；无 Key 时相关功能降级）
    ai_api_key: str = ""
    ai_base_url: str = ""
    ai_model: str = ""

    # 登录鉴权：演示账号签发 JWT。密钥从环境变量读，默认值仅供本地开发
    auth_secret: str = "logitrace-dev-secret"
    auth_token_ttl_minutes: int = 480


settings = Settings()
